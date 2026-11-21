// The local key store, the local key page and the key tools (#9352): a key is
// registered empty, the user saves its value on the page, the agent sees only
// set / empty, and a value reaches a service env file only through
// genesis_writeKeyToEnvFile into a gitignored env file. The page answers only
// with its token, on its own Host, and takes writes only from its own Origin.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';

import { resolveSettings } from '../mcp/config.mjs';
import { closeKeyPage, ensureKeyPage } from '../mcp/key-page.mjs';
import { BUILTIN_KEY, clearKeyValue, deleteKey, keyValue, listKeys, requestKey, setKeyValue } from '../mcp/key-store.mjs';
import { PKG_DIR, cleanup, tempDir } from './helpers.mjs';

after(cleanup);

const SERVER = path.join(PKG_DIR, 'mcp', 'server.mjs');
const SECRET = 'fake-value-aaaaaaaabbbb';

function home() {
  const dir = tempDir();
  return { dir, env: { HOME: dir, USERPROFILE: dir, GENESIS_SET_HOME: path.join(dir, '.genesis-set') } };
}
const configOf = (h) => JSON.parse(fs.readFileSync(path.join(h.dir, '.genesis-set', 'config.json'), 'utf8'));

/** One raw HTTP request to the page (fetch cannot set Host). */
function raw(port, { method = 'GET', pathName = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function pageParts(url) {
  const u = new URL(url);
  return { port: Number(u.port), token: u.searchParams.get('t'), origin: `http://127.0.0.1:${u.port}` };
}

/** A write from the page itself. */
function pageWrite(p, method, pathName, body) {
  return raw(p.port, {
    method,
    pathName,
    headers: {
      host: `127.0.0.1:${p.port}`,
      origin: p.origin,
      'x-genesis-key-token': p.token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
}

describe('the key store', () => {
  test('a requested key is an empty slot; asking again keeps the value and updates the text', () => {
    const h = home();
    const k = requestKey(h.env, { name: 'stripe-secret-key', label: 'Stripe secret key', description: 'Stripe dashboard, test mode' });
    assert.equal(k.status, 'empty');
    setKeyValue(h.env, 'stripe-secret-key', `  ${SECRET}  `);
    const again = requestKey(h.env, { name: 'stripe-secret-key', label: 'Stripe key (test)' });
    assert.equal(again.status, 'set');
    assert.equal(again.label, 'Stripe key (test)');
    assert.equal(again.description, 'Stripe dashboard, test mode');
    assert.equal(keyValue(h.env, 'stripe-secret-key'), SECRET);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(h.dir, '.genesis-set', 'config.json')).mode & 0o777, 0o600);
  });

  test('a listing never carries a value; only a long value shows its last four characters', () => {
    const h = home();
    requestKey(h.env, { name: 'long-key', label: 'Long' });
    requestKey(h.env, { name: 'short-key', label: 'Short' });
    setKeyValue(h.env, 'long-key', SECRET);
    setKeyValue(h.env, 'short-key', 'fake-aaa');
    const rows = listKeys(h.env);
    assert.equal(rows[0].name, BUILTIN_KEY);
    assert.ok(!JSON.stringify(rows).includes(SECRET) && !JSON.stringify(rows).includes('fake-aaa'));
    assert.equal(rows.find((r) => r.name === 'long-key').tail, 'bbbb');
    assert.equal(rows.find((r) => r.name === 'short-key').tail, null);
  });

  test('the built-in key is the Genesis API key: setting it is what the API tools read, and it cannot be deleted', () => {
    const h = home();
    setKeyValue(h.env, BUILTIN_KEY, 'fake-builtin-aaaa');
    assert.equal(resolveSettings(h.env).apiKey, 'fake-builtin-aaaa');
    assert.throws(() => setKeyValue(h.env, BUILTIN_KEY, 'two words'), /whitespace/);
    assert.throws(() => deleteKey(h.env, BUILTIN_KEY), /cannot be deleted/);
    clearKeyValue(h.env, BUILTIN_KEY);
    assert.equal(resolveSettings(h.env).apiKey, null);
    const viaEnv = listKeys({ ...h.env, GENESIS_API_KEY: 'from-env' })[0];
    assert.equal(viaEnv.status, 'set');
    assert.equal(viaEnv.source, 'GENESIS_API_KEY');
  });

  test('names, values and missing keys are refused with a Genesis code', () => {
    const h = home();
    for (const bad of ['Stripe', 'a', 'has space', '../x', 'x'.repeat(70)]) {
      assert.throws(() => requestKey(h.env, { name: bad, label: 'x' }), (e) => e.code === 'GENESIS_KEY_NAME_INVALID');
    }
    requestKey(h.env, { name: 'mail-key', label: 'Mail' });
    assert.throws(() => setKeyValue(h.env, 'mail-key', '   '), (e) => e.code === 'GENESIS_KEY_BAD_INPUT');
    assert.throws(() => setKeyValue(h.env, 'mail-key', 'two\nlines'), (e) => e.code === 'GENESIS_KEY_BAD_INPUT');
    assert.throws(() => setKeyValue(h.env, 'nope-key', 'v'), (e) => e.code === 'GENESIS_KEY_NOT_FOUND');
    deleteKey(h.env, 'mail-key');
    assert.equal(configOf(h).keys, undefined);
  });
});

describe('the key page', () => {
  afterEach(() => closeKeyPage());

  test('serves the page with its token, with no-store, no-referrer and a nonce CSP', async () => {
    const h = home();
    const link = await ensureKeyPage({ env: h.env });
    assert.match(link.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]{32}$/);
    const p = pageParts(link.url);
    const ok = await raw(p.port, { pathName: `/?t=${p.token}`, headers: { host: `127.0.0.1:${p.port}` } });
    assert.equal(ok.status, 200);
    assert.match(ok.text, /<title>Genesis keys<\/title>/);
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal(ok.headers['referrer-policy'], 'no-referrer');
    assert.match(ok.headers['content-security-policy'], /script-src 'nonce-[^']+'; .*frame-ancestors 'none'/);
    assert.doesNotMatch(ok.text, /<script(?![^>]*nonce=)/, 'every script carries the nonce');
    assert.match(ok.text, /input\.type = show \? 'text' : 'password'/, 'every value field has a Show / Hide toggle');
    assert.doesNotMatch(ok.text, /style="/, 'no inline style attribute (the CSP would block it)');
    const again = await ensureKeyPage({ env: h.env });
    assert.equal(again.url, link.url, 'one page per server while it is open');
  });

  test('refuses a missing or wrong token, a foreign Host, and a write without the page Origin or JSON', async () => {
    const h = home();
    const p = pageParts((await ensureKeyPage({ env: h.env })).url);
    const host = `127.0.0.1:${p.port}`;
    assert.equal((await raw(p.port, { pathName: '/', headers: { host } })).status, 403);
    assert.equal((await raw(p.port, { pathName: '/?t=wrong', headers: { host } })).status, 403);
    assert.equal((await raw(p.port, { pathName: '/api/keys', headers: { host } })).json().error.code, 'GENESIS_KEY_PAGE_TOKEN');
    const rebound = await raw(p.port, { pathName: `/?t=${p.token}`, headers: { host: `evil.example:${p.port}` } });
    assert.equal(rebound.status, 421);
    const t = { host, 'x-genesis-key-token': p.token, 'content-type': 'application/json' };
    const body = { name: 'x-key', label: 'X' };
    assert.equal((await raw(p.port, { method: 'POST', pathName: '/api/keys', headers: t, body })).json().error.code, 'GENESIS_KEY_PAGE_ORIGIN');
    assert.equal((await raw(p.port, { method: 'POST', pathName: '/api/keys', headers: { ...t, origin: 'https://evil.example' }, body })).status, 403);
    const form = await raw(p.port, { method: 'POST', pathName: '/api/keys', headers: { ...t, origin: p.origin, 'content-type': 'text/plain' }, body });
    assert.equal(form.status, 415);
    assert.deepEqual(listKeys(h.env).map((k) => k.name), [BUILTIN_KEY]);
  });

  test('adds, sets, clears and deletes a key; no answer carries the value', async () => {
    const h = home();
    const p = pageParts((await ensureKeyPage({ env: h.env })).url);
    assert.equal((await pageWrite(p, 'POST', '/api/keys', { name: 'resend-api-key', label: 'Resend API key', description: 'resend.com' })).status, 200);
    const set = await pageWrite(p, 'PUT', '/api/keys/resend-api-key/value', { value: SECRET });
    assert.equal(set.status, 200);
    assert.ok(!set.text.includes(SECRET));
    const list = await raw(p.port, { pathName: '/api/keys', headers: { host: `127.0.0.1:${p.port}`, 'x-genesis-key-token': p.token } });
    assert.ok(!list.text.includes(SECRET));
    assert.equal(list.json().keys.find((k) => k.name === 'resend-api-key').status, 'set');
    assert.equal(keyValue(h.env, 'resend-api-key'), SECRET);
    assert.equal((await pageWrite(p, 'PATCH', '/api/keys/resend-api-key', { label: 'Resend (prod)' })).json().key.label, 'Resend (prod)');
    assert.equal((await pageWrite(p, 'DELETE', '/api/keys/resend-api-key/value')).json().key.status, 'empty');
    assert.equal((await pageWrite(p, 'DELETE', `/api/keys/${BUILTIN_KEY}`)).json().error.code, 'GENESIS_KEY_BUILTIN');
    assert.equal((await pageWrite(p, 'DELETE', '/api/keys/resend-api-key')).status, 200);
    assert.deepEqual(listKeys(h.env).map((k) => k.name), [BUILTIN_KEY]);
  });

  test('a closed page stops answering, and a new page has a new token', async () => {
    const h = home();
    const first = pageParts((await ensureKeyPage({ env: h.env })).url);
    await closeKeyPage();
    await assert.rejects(raw(first.port, { pathName: `/?t=${first.token}`, headers: { host: `127.0.0.1:${first.port}` } }));
    const second = pageParts((await ensureKeyPage({ env: h.env })).url);
    assert.notEqual(second.token, first.token);
  });

  test('closes itself after the idle time', async () => {
    const h = home();
    const p = pageParts((await ensureKeyPage({ env: h.env, idleMs: 150 })).url);
    await new Promise((r) => setTimeout(r, 400));
    await assert.rejects(raw(p.port, { pathName: `/?t=${p.token}`, headers: { host: `127.0.0.1:${p.port}` } }));
  });
});

// ── the key tools over the MCP server's stdio ──────────────────────

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
    return { isError: msg.result.isError, text: msg.result.content[0].text, data: JSON.parse(msg.result.content[0].text) };
  };
  const close = () => new Promise((resolve) => {
    child.on('exit', resolve);
    child.stdin.end();
  });
  return { request, call, close };
}

function gitRepo(dir) {
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.secrets.env\n');
  return g;
}

describe('the key tools', () => {
  test('work without an API key: request, link, set on the page, list, write into a gitignored env file', async () => {
    const h = home();
    const project = path.join(h.dir, 'shop-orders-service');
    fs.mkdirSync(project);
    const g = gitRepo(project);
    const s = startServer(h.env, project);
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });

    const req = await s.call('genesis_requestKey', { name: 'stripe-secret-key', label: 'Stripe secret key', description: 'Stripe dashboard, Developers > API keys' });
    assert.equal(req.isError, false, req.text);
    assert.equal(req.data.key.status, 'empty');
    assert.match(req.data.keyPage.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    assert.match(req.data.next, /Never ask for the value in the chat/);

    const early = await s.call('genesis_writeKeyToEnvFile', { name: 'stripe-secret-key', file: '.dev.secrets.env', variable: 'STRIPE_KEY' });
    assert.equal(early.data.error.code, 'GENESIS_KEY_NOT_SET');

    const p = pageParts(req.data.keyPage.url);
    assert.equal((await pageWrite(p, 'PUT', '/api/keys/stripe-secret-key/value', { value: 'fake a"b\\c aaaa' })).status, 200);

    const listed = await s.call('genesis_listKeys', {});
    assert.equal(listed.data.keys.find((k) => k.name === 'stripe-secret-key').status, 'set');
    assert.ok(!listed.text.includes('fake a') && !listed.text.includes('"tail"'), 'the agent sees no value and no tail');

    fs.writeFileSync(path.join(project, '.dev.secrets.env'), 'OTHER=1\nSTRIPE_KEY=old\n');
    const wrote = await s.call('genesis_writeKeyToEnvFile', { name: 'stripe-secret-key', file: '.dev.secrets.env', variable: 'STRIPE_KEY' });
    assert.equal(wrote.isError, false, wrote.text);
    assert.equal(wrote.data.replaced, true);
    assert.ok(!wrote.text.includes('fake a'), 'the answer never carries the value');
    assert.equal(fs.readFileSync(path.join(project, '.dev.secrets.env'), 'utf8'), 'OTHER=1\nSTRIPE_KEY="fake a\\"b\\\\c aaaa"\n');

    // refusals: not an env file, an unignored file, a tracked file
    const notEnv = await s.call('genesis_writeKeyToEnvFile', { name: 'stripe-secret-key', file: 'config.json', variable: 'X' });
    assert.equal(notEnv.data.error.code, 'GENESIS_ENV_FILE_REFUSED');
    const unignored = await s.call('genesis_writeKeyToEnvFile', { name: 'stripe-secret-key', file: '.env', variable: 'X' });
    assert.match(unignored.data.error.message, /not ignored by git/);
    fs.writeFileSync(path.join(project, '.test.secrets.env'), '');
    g('add', '-f', '.test.secrets.env');
    const tracked = await s.call('genesis_writeKeyToEnvFile', { name: 'stripe-secret-key', file: '.test.secrets.env', variable: 'X' });
    assert.match(tracked.data.error.message, /tracked by git/);
    const badVar = await s.call('genesis_writeKeyToEnvFile', { name: 'stripe-secret-key', file: '.dev.secrets.env', variable: 'BAD-NAME' });
    assert.equal(badVar.data.error.code, 'GENESIS_KEY_BAD_INPUT');

    const open = await s.call('genesis_openKeyManager', {});
    assert.equal(open.data.keyPage.url, req.data.keyPage.url);
    await s.close();
    await assert.rejects(raw(p.port, { pathName: `/?t=${p.token}`, headers: { host: `127.0.0.1:${p.port}` } }), 'the page dies with the server');
  });
});

describe('genesis keys', () => {
  test('prints a fresh link, serves the page until Ctrl+C, then closes it', { skip: process.platform === 'win32' && 'Windows has no SIGINT for a child process' }, async () => {
    const h = home();
    const child = spawn(process.execPath, [path.join(PKG_DIR, 'bin', 'genesis-set.mjs'), 'keys', '--no-open'], {
      env: { PATH: process.env.PATH, ...h.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    const url = await new Promise((resolve, reject) => {
      child.stdout.on('data', (c) => {
        out += c;
        const m = out.match(/Genesis keys: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/);
        if (m) resolve(m[1]);
      });
      child.on('exit', () => reject(new Error(`exited early: ${out}`)));
      setTimeout(() => reject(new Error(`no link: ${out}`)), 10_000).unref();
    });
    const p = pageParts(url);
    const page = await raw(p.port, { pathName: `/?t=${p.token}`, headers: { host: `127.0.0.1:${p.port}` } });
    assert.equal(page.status, 200);
    assert.match(page.text, /genesis keys/);
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    child.kill('SIGINT');
    assert.equal(await exited, 0);
    assert.match(out, /The key page is closed\./);
    await assert.rejects(raw(p.port, { pathName: `/?t=${p.token}`, headers: { host: `127.0.0.1:${p.port}` } }));
  });
});
