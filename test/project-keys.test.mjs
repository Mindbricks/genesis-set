// Project identity and project-scoped keys (#9385, epic #9384). A folder is a genesis project
// when it (or a parent) holds .genesis/project.json; the project's keys live in the user's home
// under the project id, never in the project folder. A key is looked up in the project first,
// then globally; the Genesis API key is always global.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { BUILTIN_KEY, findKey, keyValue, listKeys, requestKey, setKeyValue } from '../mcp/key-store.mjs';
import { ensureProject, findProject, projectDataDir, projectKeysFile } from '../mcp/project.mjs';
import { PKG_DIR, cleanup, tempDir } from './helpers.mjs';

after(cleanup);

const SERVER = path.join(PKG_DIR, 'mcp', 'server.mjs');

function home() {
  const dir = tempDir();
  return { dir, env: { HOME: dir, USERPROFILE: dir, GENESIS_SET_HOME: path.join(dir, '.genesis-set') } };
}

function walk(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

describe('project identity', () => {
  test('ensureProject writes .genesis/project.json once; findProject walks up to it', () => {
    const root = tempDir();
    const { project, created } = ensureProject(root, { name: 'cafe' });
    assert.equal(created, true);
    assert.match(project.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.genesis', 'project.json'), 'utf8')), { id: project.id, name: 'cafe' });
    const again = ensureProject(root, { name: 'other' });
    assert.equal(again.created, false);
    assert.equal(again.project.id, project.id, 'an existing id is never changed');
    const deep = path.join(root, 'design', 'notes');
    fs.mkdirSync(deep, { recursive: true });
    assert.equal(findProject(deep).id, project.id);
    assert.equal(findProject(tempDir()), null);
  });

  test('a project id never escapes the home folder', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.genesis'));
    fs.writeFileSync(path.join(root, '.genesis', 'project.json'), JSON.stringify({ id: '../../etc', name: 'x' }));
    assert.equal(findProject(root), null);
    assert.throws(() => ensureProject(root), /not a usable project file/);
    assert.throws(() => projectDataDir({ HOME: tempDir() }, '../x'), /not a project id/);
  });
});

describe('project-scoped keys', () => {
  test('a project key lives in the home under the project id; the project folder holds only its identity', () => {
    const h = home();
    const root = tempDir();
    const { project } = ensureProject(root, { name: 'cafe' });
    requestKey(h.env, { name: 'stripe-secret-key', label: 'Stripe' }, { scope: 'project', project });
    setKeyValue(h.env, 'stripe-secret-key', 'fake-project-aaaaaaaabbbb', { scope: 'project', project });
    const file = projectKeysFile(h.env, project.id);
    assert.ok(file.startsWith(path.join(h.dir, '.genesis-set', 'projects', project.id)));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(walk(root), ['.genesis', path.join('.genesis', 'project.json')]);
    assert.ok(!fs.readFileSync(path.join(root, '.genesis', 'project.json'), 'utf8').includes('fake-project'));
  });

  test('two projects keep different values under one name; the project wins over global', () => {
    const h = home();
    const a = ensureProject(tempDir(), { name: 'a' }).project;
    const b = ensureProject(tempDir(), { name: 'b' }).project;
    for (const [p, v] of [[a, 'fake-a-aaaaaaaa'], [b, 'fake-b-bbbbbbbb']]) {
      requestKey(h.env, { name: 'mail-key', label: 'Mail' }, { scope: 'project', project: p });
      setKeyValue(h.env, 'mail-key', v, { scope: 'project', project: p });
    }
    requestKey(h.env, { name: 'mail-key', label: 'Mail' });
    setKeyValue(h.env, 'mail-key', 'fake-global-gggg');
    assert.equal(keyValue(h.env, 'mail-key', { project: a }), 'fake-a-aaaaaaaa');
    assert.equal(keyValue(h.env, 'mail-key', { project: b }), 'fake-b-bbbbbbbb');
    assert.equal(keyValue(h.env, 'mail-key'), 'fake-global-gggg');
    assert.equal(findKey(h.env, 'mail-key', { project: a }).scope, 'project');
    assert.equal(findKey(h.env, 'mail-key', { project: a, scope: 'global' }).scope, 'global');
    const rows = listKeys(h.env, { project: a });
    assert.deepEqual(rows.map((r) => `${r.scope}:${r.name}`), [`global:${BUILTIN_KEY}`, 'project:mail-key', 'global:mail-key']);
  });

  test('a project key outside a project is refused; the Genesis API key stays global', () => {
    const h = home();
    assert.throws(() => requestKey(h.env, { name: 'x-key', label: 'X' }, { scope: 'project', project: null }), (e) => e.code === 'GENESIS_KEY_NO_PROJECT');
    const project = ensureProject(tempDir()).project;
    setKeyValue(h.env, BUILTIN_KEY, 'fake-builtin-aaaa', { scope: 'project', project });
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir, '.genesis-set', 'config.json'), 'utf8')).apiKey, 'fake-builtin-aaaa');
    assert.ok(!fs.existsSync(projectKeysFile(h.env, project.id)));
  });
});

// ── the key tools inside and outside a project ─────────────────────

function startServer(env, cwd) {
  const child = spawn(process.execPath, [SERVER], { cwd, env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let id = 0;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
      setTimeout(() => reject(new Error(`no answer to ${method}`)), 10_000).unref();
    });
  const call = async (name, args) => {
    const msg = await request('tools/call', { name, arguments: args });
    return { isError: msg.result.isError, data: JSON.parse(msg.result.content[0].text) };
  };
  const close = () => new Promise((resolve) => {
    child.on('exit', resolve);
    child.stdin.end();
  });
  return { request, call, close };
}

describe('the key tools and the project', () => {
  test('inside a project a key is a project key by default; outside, global; a project key outside is refused', async () => {
    const h = home();
    const root = tempDir();
    const { project } = ensureProject(root, { name: 'cafe' });
    const sub = path.join(root, 'design');
    fs.mkdirSync(sub);
    const inside = startServer(h.env, sub);
    await inside.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const r = await inside.call('genesis_requestKey', { name: 'stripe-secret-key', label: 'Stripe' });
    assert.equal(r.isError, false, JSON.stringify(r.data));
    assert.equal(r.data.key.scope, 'project');
    assert.equal(r.data.project.name, 'cafe');
    const g = await inside.call('genesis_requestKey', { name: 'openai-key', label: 'OpenAI', scope: 'global' });
    assert.equal(g.data.key.scope, 'global');
    const list = await inside.call('genesis_listKeys', {});
    assert.deepEqual(list.data.keys.map((k) => `${k.scope}:${k.name}`), [`global:${BUILTIN_KEY}`, 'project:stripe-secret-key', 'global:openai-key']);
    await inside.close();
    assert.ok(fs.existsSync(projectKeysFile(h.env, project.id)));

    const outside = startServer(h.env, tempDir());
    await outside.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const o = await outside.call('genesis_requestKey', { name: 'mail-key', label: 'Mail' });
    assert.equal(o.data.key.scope, 'global');
    assert.equal((await outside.call('genesis_listKeys', {})).data.project, null);
    const refused = await outside.call('genesis_requestKey', { name: 'x-key', label: 'X', scope: 'project' });
    assert.equal(refused.data.error.code, 'GENESIS_KEY_NO_PROJECT');
    await outside.close();
  });

  test('genesis_writeKeyToEnvFile prefers the project key; scope "global" forces the global one', async () => {
    const h = home();
    const root = tempDir();
    const { project } = ensureProject(root, { name: 'cafe' });
    requestKey(h.env, { name: 'mail-key', label: 'Mail' }, { scope: 'project', project });
    setKeyValue(h.env, 'mail-key', 'fake-project-pppp', { scope: 'project', project });
    requestKey(h.env, { name: 'mail-key', label: 'Mail' });
    setKeyValue(h.env, 'mail-key', 'fake-global-gggg');
    const s = startServer(h.env, root);
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const a = await s.call('genesis_writeKeyToEnvFile', { name: 'mail-key', file: '.env', variable: 'MAIL_KEY' });
    assert.equal(a.isError, false, JSON.stringify(a.data));
    assert.equal(a.data.scope, 'project');
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'MAIL_KEY=fake-project-pppp\n');
    const b = await s.call('genesis_writeKeyToEnvFile', { name: 'mail-key', file: '.env', variable: 'MAIL_KEY', scope: 'global' });
    assert.equal(b.data.scope, 'global');
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'MAIL_KEY=fake-global-gggg\n');
    await s.close();
  });
});
