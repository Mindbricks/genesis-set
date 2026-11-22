// The project board (#9386, #9387, epic #9384): what it reads from a project folder (the design
// flow from the mind-set pipeline, design-check verdicts, the interview, the blueprint and its
// validation, the next step), the safe Markdown rendering, and the server: read without a token,
// write keys only with the write cookie and the board's own Origin, its own Host only, one board
// per project (reused), the genesis board command and the agent's board tool.
//
// CI installs no dependencies, so the tests bring a small mind-set of their own: a pipeline in a
// fake MIND_SET_HOME and stub design-check / validate modules in a fake mind-set package.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';

import { boardState, designDoc, interviewSummary } from '../mcp/board-data.mjs';
import { renderMarkdown } from '../mcp/board-md.mjs';
import { closeBoard, ensureBoard } from '../mcp/board.mjs';
import { keyValue } from '../mcp/key-store.mjs';
import { ensureProject, projectKeysFile } from '../mcp/project.mjs';
import { PKG_DIR, cleanup, tempDir } from './helpers.mjs';

after(cleanup);

const BIN = path.join(PKG_DIR, 'bin', 'genesis-set.mjs');
const SERVER = path.join(PKG_DIR, 'mcp', 'server.mjs');

const PIPELINE = {
  schemaVersion: 1,
  stages: ['D0', 'D2', 'D3', 'D4'],
  docs: [
    { docName: 'interview-record', stage: 'D0', class: 'source' },
    { docName: 'prd', stage: 'D2', class: 'requirement' },
    { docName: 'frontend-spec', stage: 'D2', class: 'requirement', when: { deliveryShape: 'withFrontend' } },
    { docName: 'microservice-definitions', stage: 'D3', class: 'spec' },
    { docName: 'service-spec', stage: 'D4', class: 'spec', fanOut: { docNamePrefix: 'service-spec-', roster: 'microservice-definitions', key: 'serviceRosterKey' } },
  ],
};

const STUB_DESIGN_CHECK = `
export function serviceRosterKey(n) { return n.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(); }
export function rosterNamesOf(p, content) { const m = content.match(/\`\`\`json\\n([\\s\\S]*?)\`\`\`/); return m ? JSON.parse(m[1]).map((x) => x.name) : null; }
export function checkDesignDraft(p, docName, content) {
  return content.includes('BROKEN') ? { ok: false, findings: [{ code: 'MISSING_SECTION', message: docName + ' misses a section' }] } : { ok: true, findings: [] };
}
`;
const STUB_VALIDATE = `
export function loadSchema(raw) { return raw; }
export function validateBlueprint(schema, bp) {
  const errors = (bp.services || []).filter((s) => !s.serviceSettings).map((s, i) => ({ level: 'error', path: '$.services[' + i + ']', rule: 'required', message: 'serviceSettings is required' }));
  return { errors, warnings: [], problems: errors };
}
export function formatProblem(p) { return 'ERROR ' + p.path + ' ' + p.rule + ' ' + p.message; }
`;

/** A fake mind-set: the corpus (pipeline + schema) and, unless `noChecks`, the check modules. */
function fakeMindSet({ noChecks = false } = {}) {
  const home = tempDir();
  const corpus = path.join(home, 'current');
  fs.mkdirSync(path.join(corpus, 'procedures', 'design'), { recursive: true });
  fs.writeFileSync(path.join(corpus, 'procedures', 'design', 'pipeline.json'), JSON.stringify(PIPELINE));
  fs.writeFileSync(path.join(corpus, 'openappl.json'), '{}');
  const env = { MIND_SET_HOME: home };
  if (!noChecks) {
    const pkg = tempDir();
    fs.mkdirSync(path.join(pkg, 'lib'));
    fs.writeFileSync(path.join(pkg, 'lib', 'design-check.mjs'), STUB_DESIGN_CHECK);
    fs.writeFileSync(path.join(pkg, 'lib', 'validate.mjs'), STUB_VALIDATE);
    env.GENESIS_SET_MIND_SET_PACKAGE = pkg;
  }
  return env;
}

let portBase = 41000 + Math.floor(Math.random() * 1500) * 10;
function envFor(extra = {}) {
  const home = tempDir();
  portBase += 30;
  return { HOME: home, USERPROFILE: home, GENESIS_SET_HOME: path.join(home, '.genesis-set'), GENESIS_BOARD_PORT: String(portBase), ...extra };
}

function project(files = {}) {
  const root = tempDir();
  const { project: p } = ensureProject(root, { name: 'cafe' });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return p;
}

const ROSTER = '# Microservice definitions\n\n```json\n[{ "name": "orders" }, { "name": "customerProfiles" }]\n```\n';
const INTERVIEW = '# Interview\n\n## Status\n\nclosed\n\n## Coverage Ledger\n\n| Item | State |\n|---|---|\n| domain | settled |\n| auth | OPEN: social login? |\n';

describe('the board data', () => {
  test('an empty project: the flow from the pipeline, conditional documents, and the first step', async () => {
    const env = envFor(fakeMindSet());
    const state = await boardState({ env, project: project() });
    assert.equal(state.flow.available, true);
    const byName = Object.fromEntries(state.flow.docs.map((d) => [d.docName, d]));
    assert.equal(byName['frontend-spec'].conditional, true);
    assert.equal(byName['service-spec-<service>'].placeholder, true);
    assert.ok(state.flow.docs.every((d) => !d.written));
    assert.match(state.next, /design the application\. The design documents are strongly recommended for the quality of the blueprint/);
    assert.equal(state.blueprint, null);
    assert.equal(state.designSkipped, false);
  });

  test('a project mid-design: written documents with their checks, one spec per roster service, the interview', async () => {
    const env = envFor(fakeMindSet());
    const p = project({
      'design/interview-record.md': INTERVIEW,
      'design/prd.md': '# PRD\n\nBROKEN on purpose\n',
      'design/microservice-definitions.md': ROSTER,
      'design/service-spec-orders.md': '# orders\n',
      'design/notes.md': 'scratch',
    });
    const state = await boardState({ env, project: p });
    const byName = Object.fromEntries(state.flow.docs.map((d) => [d.docName, d]));
    assert.equal(byName['interview-record'].check.ok, true);
    assert.deepEqual(byName.prd.check, { ok: false, findings: ['prd misses a section'] });
    assert.equal(byName['service-spec-orders'].written, true);
    assert.equal(byName['service-spec-customer-profiles'].written, false);
    assert.deepEqual(state.flow.other, ['notes']);
    assert.equal(state.interview.status, 'closed');
    assert.equal(state.interview.ledger.length, 3);
    assert.ok(state.interview.open.some((l) => /social login/.test(l)));
    assert.match(state.next, /Fix prd/);
  });

  test('without the mind-set check code the board says so and still lists the documents', async () => {
    const env = envFor(fakeMindSet({ noChecks: true }));
    const state = await boardState({ env, project: project({ 'design/interview-record.md': INTERVIEW }) });
    assert.equal(state.flow.checksAvailable, false);
    assert.equal(state.flow.docs.find((d) => d.docName === 'interview-record').check, null);
    assert.equal(state.validation, null);
  });

  test('the blueprint summary and its validation; a broken file is reported, not thrown', async () => {
    const env = envFor(fakeMindSet());
    const bp = { projectSettings: { basicSettings: { name: 'cafe' } }, services: [{ serviceSettings: { serviceBasics: { name: 'orders' } }, dataObjects: [{}, {}], businessLogic: [{}] }, { dataObjects: [] }] };
    const state = await boardState({ env, project: project({ 'blueprint.json': JSON.stringify(bp) }) });
    assert.equal(state.blueprint.name, 'cafe');
    assert.deepEqual(state.blueprint.services[0], { name: 'orders', dataObjects: 2, businessApis: 1 });
    assert.equal(state.validation.errors, 1);
    assert.match(state.validation.first[0], /serviceSettings is required/);
    const broken = await boardState({ env, project: project({ 'blueprint.json': '{ not json' }) });
    assert.match(broken.blueprint.error, /not valid JSON/);
  });

  test('a blueprint written without design documents: the design counts as skipped, the next step follows the blueprint', async () => {
    const env = envFor(fakeMindSet());
    const bp = { services: [{ serviceSettings: { serviceBasics: { name: 'orders' } } }] };
    const state = await boardState({ env, project: project({ 'blueprint.json': JSON.stringify(bp) }) });
    assert.equal(state.designSkipped, true);
    assert.match(state.next, /Compile the blueprint with Genesis/);
    const invalid = await boardState({ env, project: project({ 'blueprint.json': JSON.stringify({ services: [{}] }) }) });
    assert.match(invalid.next, /Fix the 1 validation error/);
  });

  test('a document is read only by its own name inside design/', () => {
    const p = project({ 'design/prd.md': 'x', 'secret.md': 'no' });
    assert.equal(designDoc(p, 'prd'), 'x');
    for (const bad of ['../secret', '..', '/etc/passwd', 'a/b', '']) assert.equal(designDoc(p, bad), null, bad);
  });

  test('interviewSummary reads the status from the heading line or the next line', () => {
    assert.equal(interviewSummary('## Status: in-progress\n').status, 'in-progress');
    assert.equal(interviewSummary('## Status\n\n**closed**\n').status, 'closed');
    assert.equal(interviewSummary(null), null);
  });
});

describe('the board Markdown', () => {
  test('escapes everything and links only http(s) and relative targets', () => {
    const html = renderMarkdown('# T\n\n<script>alert(1)</script> **b** [x](javascript:alert(1)) [y](https://e.example) `c<d`\n\n| a | b |\n|---|---|\n| <i> | 2 |\n\n```js\n<b>\n```\n');
    assert.doesNotMatch(html, /<script|<i>|<b>|href="javascript/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<strong>b<\/strong>/);
    assert.match(html, /<a href="https:\/\/e\.example" target="_blank" rel="noopener noreferrer">y<\/a>/);
    assert.match(html, /<code>c&lt;d<\/code>/);
    assert.match(html, /<table>/);
    assert.match(html, /<pre><code data-lang="js">&lt;b&gt;<\/code><\/pre>/);
  });
});

function req(port, { method = 'GET', pathName = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

describe('the board server', () => {
  afterEach(() => closeBoard());

  test('reads without a token; writes keys only with the write cookie and its own Origin; its own Host only', async () => {
    const env = envFor(fakeMindSet());
    const p = project({ 'design/prd.md': '# PRD\n\n<script>x</script>\n' });
    const b = await ensureBoard({ env, project: p });
    const port = b.port;
    assert.equal(port, Number(env.GENESIS_BOARD_PORT));
    assert.equal(b.readUrl, `http://127.0.0.1:${port}/`);
    const page = await req(port);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /script-src 'nonce-/);
    assert.match(page.text, /cafe · Genesis board/);
    // The inline script must parse: a broken quote in it leaves a blank board.
    const script = page.text.split(/<script nonce="[^"]+">/)[1].split('</script>')[0];
    assert.doesNotThrow(() => new Function(script));
    const state = (await req(port, { pathName: '/api/state' })).json();
    assert.equal(state.canWrite, false);
    assert.equal(state.project.name, 'cafe');
    const doc = (await req(port, { pathName: '/api/doc?name=prd' })).json();
    assert.match(doc.html, /&lt;script&gt;/);
    assert.equal((await req(port, { pathName: '/api/doc?name=..%2Fsecret' })).status, 404);
    assert.equal((await req(port, { headers: { host: 'evil.example' } })).status, 421);

    const write = { method: 'POST', pathName: '/api/keys', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body: { name: 'stripe-secret-key', label: 'Stripe' } };
    assert.equal((await req(port, write)).json().error.code, 'GENESIS_BOARD_READ_ONLY');

    const t = new URL(b.url).searchParams.get('t');
    const link = await req(port, { pathName: `/?t=${t}` });
    assert.equal(link.status, 303);
    assert.equal(link.headers.location, '/');
    const cookie = link.headers['set-cookie'][0].split(';')[0];
    assert.match(link.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
    const bad = await req(port, { pathName: '/?t=wrong' });
    assert.equal(bad.headers['set-cookie'], undefined);

    const withCookie = { ...write, headers: { ...write.headers, cookie } };
    assert.equal((await req(port, { ...withCookie, headers: { ...withCookie.headers, origin: 'https://evil.example' } })).json().error.code, 'GENESIS_BOARD_ORIGIN');
    assert.equal((await req(port, withCookie)).json().key.scope, 'project');
    const put = await req(port, { method: 'PUT', pathName: '/api/keys/project/stripe-secret-key/value', headers: { ...withCookie.headers }, body: { value: 'fake-board-aaaaaaaa1234' } });
    assert.equal(put.status, 200);
    assert.ok(!put.text.includes('fake-board-aaaaaaaa1234'));
    assert.equal(keyValue(env, 'stripe-secret-key', { project: p }), 'fake-board-aaaaaaaa1234');
    assert.ok(fs.existsSync(projectKeysFile(env, p.id)));
    const after = (await req(port, { pathName: '/api/state', headers: { cookie } })).json();
    assert.equal(after.canWrite, true);
    assert.equal(after.keys.find((k) => k.name === 'stripe-secret-key').masked, 'fake-board-...1234');
  });

  test('one board per project: the same process and another process reuse it', async () => {
    const env = envFor(fakeMindSet());
    const p = project();
    const first = await ensureBoard({ env, project: p });
    const again = await ensureBoard({ env, project: p });
    assert.equal(again.port, first.port);
    assert.equal(again.reused, true);
    // Async: a spawnSync would block this process, and with it the board the child must reach.
    const child = spawn(process.execPath, [BIN, 'board', p.root, '--no-open'], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    const code = await new Promise((resolve) => child.on('exit', resolve));
    clearTimeout(timer);
    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`http://127\\.0\\.0\\.1:${first.port}/`));
    assert.match(out, /already runs in another process/);
  });

  test('genesis board outside a project says how to make one', () => {
    const env = envFor();
    const res = spawnSync(process.execPath, [BIN, 'board', tempDir(), '--no-open'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /not a genesis project\. Run "genesis init"/);
  });

  test('genesis board serves until Ctrl+C', { skip: process.platform === 'win32' && 'Windows has no SIGINT for a child process' }, async () => {
    const env = envFor(fakeMindSet());
    const p = project();
    const child = spawn(process.execPath, [BIN, 'board', p.root, '--no-open'], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    const port = await new Promise((resolve, reject) => {
      child.stdout.on('data', (c) => {
        out += c;
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (m && /press Ctrl\+C/.test(out)) resolve(Number(m[1]));
      });
      setTimeout(() => reject(new Error(`no link: ${out}`)), 10_000).unref();
    });
    assert.match(out, /To change keys, open: http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    assert.equal((await req(port, { pathName: '/api/state' })).json().project.id, p.id);
    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGINT');
    assert.equal(await exited, 0);
    await assert.rejects(req(port, { pathName: '/api/state' }));
    assert.ok(!fs.existsSync(path.join(env.GENESIS_SET_HOME, 'board', `${port}.json`)), 'the token file goes with the board');
  });
});

describe('the agent and the board', () => {
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
    const request = (method, params) => new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
      setTimeout(() => reject(new Error(`no answer to ${method}`)), 10_000).unref();
    });
    const call = async (name, args) => {
      const msg = await request('tools/call', { name, arguments: args });
      return { isError: msg.result.isError, data: JSON.parse(msg.result.content[0].text) };
    };
    const close = () => new Promise((resolve) => { child.on('exit', resolve); child.stdin.end(); });
    return { request, call, close };
  }

  test('genesis_openBoard gives the project board; inside a project a key request links to its Keys tab; outside, no board', async () => {
    const env = envFor(fakeMindSet());
    const p = project();
    const s = startServer(env, p.root);
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    const b = await s.call('genesis_openBoard', {});
    assert.equal(b.isError, false, JSON.stringify(b.data));
    assert.match(b.data.board.url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=/);
    assert.equal(b.data.project.name, 'cafe');
    const k = await s.call('genesis_requestKey', { name: 'mail-key', label: 'Mail' });
    assert.match(k.data.keyPage.url, new RegExp(`^http://127\\.0\\.0\\.1:${b.data.board.port}/\\?t=.*#keys$`));
    assert.match(k.data.next, /"genesis board" in the project folder/);
    await s.close();

    const outside = startServer(env, tempDir());
    await outside.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    assert.equal((await outside.call('genesis_openBoard', {})).data.error.code, 'GENESIS_KEY_NO_PROJECT');
    await outside.close();
  });
});
