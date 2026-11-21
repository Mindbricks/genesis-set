// The genesis-set MCP server (#9183) against a local stub of the Genesis
// Compiler API: the MCP handshake, the five genesis_* tools, what each one
// sends (and only that), the local size check, where the API key comes from
// (environment or the home config file, never the project folder) and the
// pass-through of Genesis errors.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PKG_DIR, cleanup, makeHome, tempDir } from './helpers.mjs';

after(cleanup);

const SERVER = path.join(PKG_DIR, 'mcp', 'server.mjs');
const KEY = 'fake-key-aaaa';
const API = '/genesis/compiler/v1';

// ── the stub Genesis API ────────────────────────────────────────────

let stub;
let requests = [];
let respond = () => [200, { ok: true }];

before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(rec);
      const [status, json, raw] = respond(rec);
      res.writeHead(status, { 'content-type': raw ? 'text/html' : 'application/json' });
      res.end(raw ?? JSON.stringify(json));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
});
after(() => new Promise((r) => stub.close(r)));
beforeEach(() => {
  requests = [];
  respond = () => [200, { ok: true }];
});
const base = () => `http://127.0.0.1:${stub.address().port}`;

// ── an MCP client over the server's stdio ───────────────────────────

function startServer({ env = {}, cwd } = {}) {
  const home = env.HOME ?? makeHome();
  const child = spawn(process.execPath, [SERVER], {
    cwd: cwd ?? home,
    env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, GENESIS_API_BASE: base(), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let nextId = 1;
  const waiting = new Map();
  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lines.push(line);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`no answer to ${method}; stderr: ${stderr}`)), 10_000).unref();
    });
  const notify = (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  const close = () =>
    new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
      child.stdin.end();
    });
  return { child, request, notify, close, lines, home, stderr: () => stderr };
}

async function session(opts) {
  const s = startServer(opts);
  const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  s.notify('notifications/initialized', {});
  return { ...s, init };
}

async function call(s, name, args) {
  const msg = await s.request('tools/call', { name, arguments: args });
  assert.ok(msg.result, JSON.stringify(msg));
  return { isError: msg.result.isError, data: JSON.parse(msg.result.content[0].text) };
}

function blueprintFile(dir, obj = { projectSettings: { basicSettings: { name: 'shop' } }, services: [] }, name = 'blueprint.json') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}

// ── tests ───────────────────────────────────────────────────────────

describe('MCP protocol', () => {
  test('initialize negotiates the version, tools/list names the five tools, ping answers', async () => {
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    assert.equal(s.init.result.protocolVersion, '2025-06-18');
    assert.equal(s.init.result.serverInfo.name, 'genesis-set');
    assert.ok(s.init.result.capabilities.tools);
    const list = await s.request('tools/list', {});
    assert.deepEqual(
      list.result.tools.map((t) => t.name).sort(),
      [
        'genesis_buildService',
        'genesis_getBuilds',
        'genesis_getServiceBuild',
        'genesis_listKeys',
        'genesis_openKeyManager',
        'genesis_requestKey',
        'genesis_validateApplication',
        'genesis_validateService',
        'genesis_writeKeyToEnvFile',
      ],
    );
    for (const t of list.result.tools) assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.deepEqual((await s.request('ping')).result, {});
    assert.equal((await s.request('nope/method', {})).error.code, -32601);
    assert.equal((await s.request('tools/call', { name: 'genesis_nope', arguments: {} })).error.code, -32602);
    const old = startServer({ env: { GENESIS_API_KEY: KEY } });
    assert.equal((await old.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} })).result.protocolVersion, '2024-11-05');
    const odd = startServer({ env: { GENESIS_API_KEY: KEY } });
    assert.equal((await odd.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} })).result.protocolVersion, '2025-06-18');
    for (const x of [s, old, odd]) assert.equal(await x.close(), 0);
    assert.ok(s.lines.every((l) => JSON.parse(l).jsonrpc === '2.0'), 'stdout carries JSON-RPC only');
    assert.equal(requests.length, 0, 'no API call without a tool call');
  });

  test('a line that is not JSON is a parse error, the server keeps serving', async () => {
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    s.child.stdin.write('not json\n');
    assert.deepEqual((await s.request('ping')).result, {});
    assert.ok(s.lines.some((l) => JSON.parse(l).error?.code === -32700));
    await s.close();
  });
});

describe('the tools and what they send', () => {
  test('genesis_validateApplication reads the local file and sends it inline with the bearer key, nothing else', async () => {
    const dir = tempDir();
    const bp = { projectSettings: { basicSettings: { name: 'shop' } }, services: [{ serviceSettings: { serviceBasics: { name: 'orders' } } }] };
    const file = blueprintFile(dir, bp);
    respond = () => [200, { valid: true, codename: 'shop', language: 'nodejs', blueprintHash: 'h', services: ['orders'] }];
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_validateApplication', { blueprintPath: file, language: 'nodejs' });
    assert.equal(r.isError, false);
    assert.equal(r.data.httpStatus, 200);
    assert.equal(r.data.valid, true);
    assert.equal(requests.length, 1);
    const [q] = requests;
    assert.equal(q.method, 'POST');
    assert.equal(q.url, `${API}/validate`);
    assert.equal(q.headers.authorization, `Bearer ${KEY}`);
    assert.match(q.headers['user-agent'], /^genesis-set\/\d+\.\d+\.\d+ \(mcp\)$/);
    assert.deepEqual(q.body, { blueprint: { inline: bp }, language: 'nodejs' });
    assert.ok(!JSON.stringify(q.body).includes(dir), 'the local path is never sent');
    await s.close();
  });

  test('a relative blueprint path resolves against the folder the server runs in', async () => {
    const dir = tempDir();
    blueprintFile(dir);
    const s = await session({ env: { GENESIS_API_KEY: KEY }, cwd: dir });
    const r = await call(s, 'genesis_validateApplication', { blueprintPath: 'blueprint.json' });
    assert.equal(r.isError, false, JSON.stringify(r.data));
    assert.equal(requests.length, 1);
    await s.close();
  });

  test('genesis_validateService: whole blueprint, fragment, and exactly one source', async () => {
    const dir = tempDir();
    const file = blueprintFile(dir);
    const fragment = { serviceSettings: { serviceBasics: { name: 'orders' } } };
    const frag = blueprintFile(dir, fragment, 'orders.json');
    respond = () => [200, { valid: true, serviceName: 'orders', notChecked: [] }];
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    await call(s, 'genesis_validateService', { serviceName: 'orders', blueprintPath: file });
    await call(s, 'genesis_validateService', { serviceName: 'orders', fragmentPath: frag });
    assert.equal(requests[0].url, `${API}/validate/service`);
    assert.deepEqual(Object.keys(requests[0].body.blueprint), ['inline']);
    assert.deepEqual(requests[1].body, { serviceName: 'orders', blueprint: { fragment } });
    const both = await call(s, 'genesis_validateService', { serviceName: 'orders', blueprintPath: file, fragmentPath: frag });
    assert.equal(both.isError, true);
    assert.equal(both.data.error.code, 'GENESIS_BAD_ARGUMENTS');
    const none = await call(s, 'genesis_validateService', { serviceName: 'orders' });
    assert.equal(none.data.error.code, 'GENESIS_BAD_ARGUMENTS');
    const noName = await call(s, 'genesis_validateService', { blueprintPath: file });
    assert.match(noName.data.error.message, /"serviceName" is required/);
    assert.equal(requests.length, 2, 'a refused call sends nothing');
    await s.close();
  });

  test('genesis_buildService posts ONE service as a dry run with an Idempotency-Key it returns; a retry reuses it', async () => {
    const dir = tempDir();
    const file = blueprintFile(dir);
    respond = (q) => [202, { build: { id: 'b1', status: 'queued', services: [{ serviceName: q.body.services[0], jobId: 'j1' }] }, jobId: 'j1' }];
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_buildService', { blueprintPath: file, serviceName: 'orders', deployTargets: ['docker-compose', 'railway'] });
    assert.equal(r.isError, false);
    assert.equal(r.data.httpStatus, 202);
    assert.equal(r.data.jobId, 'j1');
    const [q] = requests;
    assert.equal(q.url, `${API}/builds`);
    assert.equal(q.body.dryRun, true);
    assert.deepEqual(q.body.services, ['orders']);
    assert.deepEqual(q.body.deployTargets, ['docker-compose', 'railway']);
    assert.deepEqual(Object.keys(q.body).sort(), ['blueprint', 'deployTargets', 'dryRun', 'services']);
    assert.equal(q.headers['idempotency-key'], r.data.idempotencyKey);
    assert.match(r.data.idempotencyKey, /^[0-9a-f-]{36}$/);
    await call(s, 'genesis_buildService', { blueprintPath: file, serviceName: 'orders', idempotencyKey: r.data.idempotencyKey });
    assert.equal(requests[1].headers['idempotency-key'], r.data.idempotencyKey);
    const extra = await call(s, 'genesis_buildService', { blueprintPath: file, serviceName: 'orders', push: 'direct' });
    assert.equal(extra.data.error.code, 'GENESIS_BAD_ARGUMENTS');
    assert.match(extra.data.error.message, /unknown argument\(s\): push/);
    assert.equal(requests.length, 2);
    await s.close();
  });

  test('genesis_getBuilds passes the filters as the query; genesis_getServiceBuild reads the job', async () => {
    respond = (q) => (q.url.startsWith(`${API}/jobs/`) ? [200, { job: { id: 'j/1', status: 'running' } }] : [200, { builds: [], nextCursor: null }]);
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_getBuilds', { codename: 'shop', status: 'failed', serviceName: 'orders', since: '2026-11-01', limit: 5, cursor: 'abc' });
    assert.equal(r.isError, false);
    const u = new URL(requests[0].url, 'http://x');
    assert.equal(u.pathname, `${API}/builds`);
    assert.deepEqual(Object.fromEntries(u.searchParams), { codename: 'shop', status: 'failed', serviceName: 'orders', since: '2026-11-01', limit: '5', cursor: 'abc' });
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].body, undefined);
    const bad = await call(s, 'genesis_getBuilds', { status: 'done' });
    assert.equal(bad.data.error.code, 'GENESIS_BAD_ARGUMENTS');
    const j = await call(s, 'genesis_getServiceBuild', { jobId: 'j/1' });
    assert.equal(j.data.job.status, 'running');
    assert.equal(requests[1].url, `${API}/jobs/j%2F1`);
    await s.close();
  });

  test('the repo source is passed through as given; the API answers that it is not available yet', async () => {
    respond = () => [422, { error: { code: 'GENESIS_BLUEPRINT_SOURCE_NOT_AVAILABLE', message: 'Reading the blueprint from a git repository is not available yet; send it inline' } }];
    const repo = { provider: 'github', repo: 'acme/shop-blueprint', ref: 'main', path: 'blueprint.json' };
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_validateApplication', { repo });
    assert.deepEqual(requests[0].body, { blueprint: { git: repo } });
    assert.equal(r.isError, true);
    assert.equal(r.data.httpStatus, 422);
    assert.equal(r.data.error.code, 'GENESIS_BLUEPRINT_SOURCE_NOT_AVAILABLE');
    const b = await call(s, 'genesis_buildService', { repo, serviceName: 'orders' });
    assert.deepEqual(requests[1].body.blueprint, { git: repo });
    assert.equal(b.data.error.code, 'GENESIS_BLUEPRINT_SOURCE_NOT_AVAILABLE');
    await s.close();
  });
});

describe('local checks before any call', () => {
  test('a blueprint over the limit is refused locally and nothing is sent', async () => {
    const dir = tempDir();
    const big = blueprintFile(dir, { projectSettings: {}, blob: 'x'.repeat(5000) });
    const s = await session({ env: { GENESIS_API_KEY: KEY, GENESIS_MAX_BLUEPRINT_BYTES: '4096' } });
    const r = await call(s, 'genesis_validateApplication', { blueprintPath: big });
    assert.equal(r.isError, true);
    assert.equal(r.data.httpStatus, null);
    assert.equal(r.data.error.code, 'GENESIS_BLUEPRINT_TOO_LARGE');
    assert.equal(r.data.error.details.checkedLocally, true);
    assert.equal(r.data.error.details.limit, 4096);
    const b = await call(s, 'genesis_buildService', { blueprintPath: big, serviceName: 'orders' });
    assert.equal(b.data.error.code, 'GENESIS_BLUEPRINT_TOO_LARGE');
    assert.equal(requests.length, 0);
    await s.close();
  });

  test('the default limit is the server limit (10 MiB of compact JSON)', async () => {
    const dir = tempDir();
    const file = blueprintFile(dir, { projectSettings: {}, blob: 'x'.repeat(10 * 1024 * 1024) });
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_validateApplication', { blueprintPath: file });
    assert.equal(r.data.error.code, 'GENESIS_BLUEPRINT_TOO_LARGE');
    assert.equal(r.data.error.details.limit, 10 * 1024 * 1024);
    assert.equal(requests.length, 0);
    await s.close();
  });

  test('a missing file, a file that is not JSON and a JSON array are clear local errors', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');
    fs.writeFileSync(path.join(dir, 'list.json'), '[]');
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    assert.equal((await call(s, 'genesis_validateApplication', { blueprintPath: path.join(dir, 'missing.json') })).data.error.code, 'GENESIS_BLUEPRINT_FILE_NOT_FOUND');
    assert.equal((await call(s, 'genesis_validateApplication', { blueprintPath: path.join(dir, 'bad.json') })).data.error.code, 'GENESIS_BLUEPRINT_FILE_INVALID');
    assert.equal((await call(s, 'genesis_validateApplication', { blueprintPath: path.join(dir, 'list.json') })).data.error.code, 'GENESIS_BLUEPRINT_FILE_INVALID');
    assert.equal(requests.length, 0);
    await s.close();
  });
});

describe('the API key', () => {
  test('no key: one clear error naming how to set it, and nothing is sent', async () => {
    const dir = tempDir();
    const file = blueprintFile(dir);
    const s = await session();
    for (const [name, args] of [
      ['genesis_validateApplication', { blueprintPath: file }],
      ['genesis_getBuilds', {}],
      ['genesis_getServiceBuild', { jobId: 'j1' }],
    ]) {
      const r = await call(s, name, args);
      assert.equal(r.isError, true);
      assert.equal(r.data.error.code, 'GENESIS_API_KEY_MISSING');
      assert.match(r.data.error.message, /GENESIS_API_KEY/);
      assert.match(r.data.error.message, /genesis-set config set-key/);
      assert.match(r.data.error.message, /portal\.genesiscompiler\.com\/keys/);
      assert.match(r.data.error.message, /Never put the key in the project folder/);
    }
    assert.equal(requests.length, 0);
    await s.close();
  });

  test('the home config file holds the key; a project-folder config or .env is never read', async () => {
    const home = makeHome();
    const project = tempDir();
    fs.mkdirSync(path.join(project, '.genesis-set'));
    fs.writeFileSync(path.join(project, '.genesis-set', 'config.json'), JSON.stringify({ apiKey: 'sk_project_folder' }));
    fs.writeFileSync(path.join(project, 'config.json'), JSON.stringify({ apiKey: 'sk_project_folder' }));
    fs.writeFileSync(path.join(project, '.env'), 'GENESIS_API_KEY=sk_project_folder\n');
    const s = await session({ env: { HOME: home }, cwd: project });
    assert.equal((await call(s, 'genesis_getBuilds', {})).data.error.code, 'GENESIS_API_KEY_MISSING');
    // stored later in the home config: picked up on the next call, no restart
    fs.mkdirSync(path.join(home, '.genesis-set'), { recursive: true });
    fs.writeFileSync(path.join(home, '.genesis-set', 'config.json'), JSON.stringify({ apiKey: 'sk_home_file' }));
    const r = await call(s, 'genesis_getBuilds', {});
    assert.equal(r.isError, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, 'Bearer sk_home_file');
    await s.close();
  });

  test('GENESIS_API_KEY wins over the config file', async () => {
    const home = makeHome();
    fs.mkdirSync(path.join(home, '.genesis-set'));
    fs.writeFileSync(path.join(home, '.genesis-set', 'config.json'), JSON.stringify({ apiKey: 'sk_home_file' }));
    const s = await session({ env: { HOME: home, GENESIS_API_KEY: KEY } });
    await call(s, 'genesis_getBuilds', {});
    assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
    await s.close();
  });

  test('a rejected key passes the Genesis 401 through, with a hint on how to set the right one', async () => {
    respond = () => [401, { error: { code: 'GENESIS_UNAUTHENTICATED', message: 'Genesis Compiler API authentication failed: invalid API key' } }];
    const s = await session({ env: { GENESIS_API_KEY: 'sk_wrong' } });
    const r = await call(s, 'genesis_getBuilds', {});
    assert.equal(r.isError, true);
    assert.equal(r.data.httpStatus, 401);
    assert.equal(r.data.error.code, 'GENESIS_UNAUTHENTICATED');
    assert.equal(r.data.error.message, 'Genesis Compiler API authentication failed: invalid API key');
    assert.match(r.data.hint, /GENESIS_API_KEY/);
    await s.close();
  });
});

describe('errors pass through in the Genesis shape', () => {
  test('a 422 with findings comes back unchanged', async () => {
    const body = {
      valid: false,
      error: { code: 'GENESIS_BLUEPRINT_INVALID', message: 'The blueprint failed validation (1 error)', details: { errors: [{ path: 'services[0]', code: 'X', message: 'm' }], warnings: [] } },
    };
    respond = () => [422, body];
    const dir = tempDir();
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_validateApplication', { blueprintPath: blueprintFile(dir) });
    assert.equal(r.isError, true);
    assert.deepEqual(r.data, { httpStatus: 422, ...body });
    await s.close();
  });

  test('a non-JSON answer and an unreachable API are written in the same shape', async () => {
    respond = () => [502, null, '<html>Bad gateway</html>'];
    const s = await session({ env: { GENESIS_API_KEY: KEY } });
    const r = await call(s, 'genesis_getBuilds', {});
    assert.equal(r.data.httpStatus, 502);
    assert.equal(r.data.error.code, 'GENESIS_BAD_RESPONSE');
    await s.close();
    const down = await session({ env: { GENESIS_API_KEY: KEY, GENESIS_API_BASE: 'http://127.0.0.1:9' } });
    const u = await call(down, 'genesis_getBuilds', {});
    assert.equal(u.isError, true);
    assert.equal(u.data.error.code, 'GENESIS_UNREACHABLE');
    assert.match(u.data.error.message, /could not be reached/);
    assert.doesNotMatch(u.data.error.message, /pre-release|not reachable yet/);
    await down.close();
  });

  test('a plain-http API base on a non-local host is refused: no call, no fallback to another host', async () => {
    const s = await session({ env: { GENESIS_API_KEY: KEY, GENESIS_API_BASE: 'http://api.example.com' } });
    const r = await call(s, 'genesis_getServiceBuild', { jobId: 'j1' });
    assert.equal(r.isError, true);
    assert.equal(r.data.error.code, 'GENESIS_BAD_API_BASE');
    assert.match(r.data.error.message, /plain http on a non-local host/);
    assert.equal(requests.length, 0);
    await s.close();
  });

  test('an API base given with the API path is not doubled', async () => {
    const s = await session({ env: { GENESIS_API_KEY: KEY, GENESIS_API_BASE: `${base()}/genesis/compiler/v1/` } });
    await call(s, 'genesis_getBuilds', {});
    assert.equal(requests[0].url, `${API}/builds`);
    await s.close();
  });
});

describe('closing stdin', () => {
  test('every answer is written out in full before the server exits', () => {
    // Many requests and then end of input: the server must flush every answer before it exits
    // (a process.exit on a pipe drops unwritten output; it once cut a tools/list at 8 KiB).
    const home = makeHome();
    const requests = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } }];
    for (let i = 1; i <= 40; i++) requests.push({ jsonrpc: '2.0', id: i, method: 'tools/list' });
    const res = spawnSync(process.execPath, [SERVER], {
      input: requests.map((m) => JSON.stringify(m)).join('\n') + '\n',
      encoding: 'utf8',
      env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH },
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(res.status, 0, res.stderr);
    const answers = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(answers.length, 41);
    assert.ok(res.stdout.length > 256 * 1024, `the answers are large enough to fill a pipe (${res.stdout.length} bytes)`);
    for (const a of answers.slice(1)) assert.equal(a.result.tools.length, 9);
  });
});
