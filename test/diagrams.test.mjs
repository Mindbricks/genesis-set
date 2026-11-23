// The project diagrams (#9407): genesis_buildDiagrams against a stub Genesis API (what it sends,
// where it writes, what it answers), the board's reading of the two places a set can be (drawn
// with the tool, delivered with the document service), the Diagrams tab's pages and their
// policies, and the renderer cache (pinned sha256, never an unchecked file).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

import { DIAGRAMS_FILE, DIAGRAMS_SCHEMA, MERMAID_VERSION, blueprintHashOf, diagramsBundle, diagramsState, mermaidCacheFile, mermaidScript } from '../mcp/board-diagrams.mjs';
import { closeBoard, ensureBoard } from '../mcp/board.mjs';
import { ensureProject } from '../mcp/project.mjs';
import { PKG_DIR, cleanup, makeHome, tempDir } from './helpers.mjs';

after(cleanup);
/** Every MCP server a test started: killed at the end even when a test failed before closing it. */
const children = [];
after(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
});

const SERVER = path.join(PKG_DIR, 'mcp', 'server.mjs');
const KEY = 'fake-key-dddd';
const API = '/genesis/compiler/v1';
const BLUEPRINT = { projectSettings: { basicSettings: { name: 'cafe' } }, services: [{ serviceSettings: { serviceBasics: { name: 'orders' } } }] };

/** A small set in the shape POST /diagrams answers. */
function bundle({ hash = blueprintHashOf(BLUEPRINT), at = '2026-11-22T10:00:00.000Z', valid = true } = {}) {
  const d = (kind, service, api, regions = []) => ({ kind, service, api, title: `${kind} ${service}`, type: 'flowchart', mermaid: 'flowchart LR\n  s0[[orders]]', regions });
  return {
    schema: DIAGRAMS_SCHEMA,
    note: 'n',
    codename: 'cafe',
    blueprintHash: hash,
    generatedAt: at,
    emitterVersion: '6',
    valid,
    ...(valid ? {} : { validation: { message: 'm', errorCount: 12, errors: Array.from({ length: 12 }, (_, i) => ({ path: `p${i}`, code: 'C', message: 'bad' })) } }),
    roots: [{ key: 'architecture', title: 'Architecture', id: 'projectFlowchart//' }],
    others: ['eventHub//'],
    count: 3,
    diagrams: {
      'projectFlowchart//': d('projectFlowchart', '', '', [{ nodeId: 's0', kind: 'serviceFlowchart', target: { service: 'orders' }, to: 'serviceFlowchart/orders/' }]),
      'serviceFlowchart/orders/': d('serviceFlowchart', 'orders', ''),
      'eventHub//': d('eventHub', '', ''),
    },
  };
}

function project(files = {}) {
  const root = tempDir();
  const { project: p } = ensureProject(root, { name: 'cafe' });
  for (const [rel, value] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
  return p;
}

// ── the stub Genesis API and an MCP client ────────────────────────────

let stub;
let requests = [];
let respond = () => [200, { diagrams: bundle() }];

before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(rec);
      const [status, json] = respond(rec);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
});
after(() => new Promise((r) => stub.close(r)));
beforeEach(() => {
  requests = [];
  respond = () => [200, { diagrams: bundle() }];
});

async function session(cwd) {
  const home = makeHome();
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, GENESIS_API_BASE: `http://127.0.0.1:${stub.address().port}`, GENESIS_API_KEY: KEY },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let buf = '';
  let nextId = 1;
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
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`no answer to ${method}`)), 10_000).unref();
    });
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  const call = async (name, args) => {
    const msg = await request('tools/call', { name, arguments: args });
    return { isError: msg.result.isError, data: JSON.parse(msg.result.content[0].text) };
  };
  const close = () => new Promise((r) => { child.on('exit', r); child.stdin.end(); });
  return { request, call, close };
}

describe('genesis_buildDiagrams', () => {
  test('sends the project blueprint to POST /diagrams and writes the whole set to diagrams/diagrams.json; answers a summary', async () => {
    const p = project({ 'blueprint.json': BLUEPRINT });
    const s = await session(p.root);
    const list = await s.request('tools/list', {});
    const tool = list.result.tools.find((t) => t.name === 'genesis_buildDiagrams');
    assert.ok(tool, 'the tool is listed');
    assert.equal(tool.inputSchema.additionalProperties, false);
    const r = await s.call('genesis_buildDiagrams', { language: 'nodejs' });
    assert.equal(r.isError, false, JSON.stringify(r.data));
    assert.equal(requests.length, 1);
    const [q] = requests;
    assert.equal(q.method, 'POST');
    assert.equal(q.url, `${API}/diagrams`);
    assert.equal(q.headers.authorization, `Bearer ${KEY}`);
    assert.deepEqual(q.body, { blueprint: { inline: BLUEPRINT }, language: 'nodejs' });
    const file = path.join(p.root, DIAGRAMS_FILE);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), bundle());
    assert.equal(fs.realpathSync(r.data.diagrams.file), fs.realpathSync(file));
    assert.equal(r.data.diagrams.count, 3);
    assert.deepEqual(r.data.diagrams.roots, ['Architecture']);
    assert.equal(r.data.diagrams.others, 1);
    assert.equal(r.data.validation, undefined);
    assert.ok(!JSON.stringify(r.data).includes('flowchart LR'), 'the answer is a summary, not the set');
    assert.match(r.data.next, /Diagrams tab/);
    // Again: the set is replaced (a refresh), nothing else is left behind.
    respond = () => [200, { diagrams: bundle({ at: '2026-11-22T11:00:00.000Z', valid: false }) }];
    const again = await s.call('genesis_buildDiagrams', {});
    assert.equal(again.data.diagrams.valid, false);
    assert.equal(again.data.validation.errorCount, 12);
    assert.equal(again.data.validation.firstErrors.length, 10);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).generatedAt, '2026-11-22T11:00:00.000Z');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['diagrams.json']);
    await s.close();
  });

  test('a given blueprintPath is sent instead; outside a project the set goes to the current folder', async () => {
    const dir = tempDir();
    const other = { ...BLUEPRINT, services: [] };
    fs.writeFileSync(path.join(dir, 'bp.json'), JSON.stringify(other));
    const s = await session(dir);
    const r = await s.call('genesis_buildDiagrams', { blueprintPath: 'bp.json' });
    assert.equal(r.isError, false, JSON.stringify(r.data));
    assert.deepEqual(requests[0].body, { blueprint: { inline: other } });
    assert.ok(fs.existsSync(path.join(dir, DIAGRAMS_FILE)));
    await s.close();
  });

  test('outside a project without a blueprint it says what to do and calls nothing; an API error writes nothing', async () => {
    const dir = tempDir();
    const s = await session(dir);
    const r = await s.call('genesis_buildDiagrams', {});
    assert.equal(r.isError, true);
    assert.equal(r.data.error.code, 'GENESIS_NO_PROJECT');
    assert.equal(requests.length, 0);
    await s.close();

    const p = project({ 'blueprint.json': BLUEPRINT });
    respond = () => [422, { error: { code: 'GENESIS_BLUEPRINT_INVALID', message: 'Nothing could be drawn', details: { errors: [] } } }];
    const s2 = await session(p.root);
    const bad = await s2.call('genesis_buildDiagrams', {});
    assert.equal(bad.isError, true);
    assert.equal(bad.data.httpStatus, 422);
    assert.equal(bad.data.error.code, 'GENESIS_BLUEPRINT_INVALID');
    assert.equal(fs.existsSync(path.join(p.root, DIAGRAMS_FILE)), false);
    await s2.close();
  });
});

describe('the board reads the diagram set', () => {
  test('none: null; the drawn set or the delivered one, the newer wins; a changed blueprint is flagged', () => {
    const empty = project({ 'blueprint.json': BLUEPRINT });
    assert.equal(diagramsState(empty.root, BLUEPRINT), null);
    assert.equal(diagramsBundle(empty.root), null);

    const p = project({
      'blueprint.json': BLUEPRINT,
      'diagrams/diagrams.json': bundle({ at: '2026-11-22T09:00:00.000Z' }),
      'cafe-document-service/diagrams/diagrams.json': bundle({ at: '2026-11-22T10:00:00.000Z', valid: false }),
    });
    let st = diagramsState(p.root, BLUEPRINT);
    assert.equal(st.source, 'build');
    assert.equal(st.file, 'cafe-document-service/diagrams/diagrams.json');
    assert.equal(st.valid, false);
    assert.equal(st.errorCount, 12);
    assert.equal(st.count, 3);
    assert.equal(st.blueprintChanged, false);
    // A fresh draw is newer than the build's.
    fs.writeFileSync(path.join(p.root, DIAGRAMS_FILE), JSON.stringify(bundle({ at: '2026-11-22T12:00:00.000Z' })));
    st = diagramsState(p.root, BLUEPRINT);
    assert.equal(st.source, 'drawn');
    assert.equal(st.file, 'diagrams/diagrams.json');
    assert.equal(diagramsBundle(p.root).bundle.generatedAt, '2026-11-22T12:00:00.000Z');
    // The blueprint changed after the draw; without a readable blueprint nothing is claimed.
    assert.equal(diagramsState(p.root, { ...BLUEPRINT, services: [] }).blueprintChanged, true);
    assert.equal(diagramsState(p.root, null).blueprintChanged, null);
  });

  test('a file that is not a diagram set is reported, never thrown', () => {
    const p = project({ 'diagrams/diagrams.json': '{ nope' });
    assert.match(diagramsState(p.root, null).error, /not valid JSON/);
    fs.writeFileSync(path.join(p.root, DIAGRAMS_FILE), JSON.stringify({ schema: 'other/1' }));
    assert.match(diagramsState(p.root, null).error, /not a genesis-diagrams\/1 file/);
    assert.equal(diagramsBundle(p.root), null);
  });
});

function get(port, pathName) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathName, headers: { host: `127.0.0.1:${port}` } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
        });
      })
      .on('error', reject);
  });
}

let portBase = 46000 + Math.floor(Math.random() * 1500) * 10;
function envFor(extra = {}) {
  const home = tempDir();
  portBase += 30;
  return { HOME: home, USERPROFILE: home, GENESIS_SET_HOME: path.join(home, '.genesis-set'), GENESIS_BOARD_PORT: String(portBase), ...extra };
}

describe('the Diagrams tab on the board', () => {
  afterEach(() => closeBoard());

  test('the state carries the set; /api/diagrams serves it; the board frames only its own diagram page', async () => {
    const env = envFor();
    const none = project();
    let b = await ensureBoard({ env, project: none });
    assert.equal((await get(b.port, '/api/state')).json().diagrams, null);
    assert.equal((await get(b.port, '/api/diagrams')).json().error.code, 'GENESIS_BOARD_NO_DIAGRAMS');
    const page = await get(b.port, '/');
    assert.match(page.headers['content-security-policy'], /frame-src 'self'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(page.text, /data-tab="diagrams"/);
    const script = page.text.split(/<script nonce="[^"]+">/)[1].split('</script>')[0];
    assert.doesNotThrow(() => new Function(script));
    await closeBoard();

    const p = project({ 'blueprint.json': BLUEPRINT, 'diagrams/diagrams.json': bundle() });
    b = await ensureBoard({ env: envFor(), project: p });
    const st = (await get(b.port, '/api/state')).json();
    assert.equal(st.diagrams.count, 3);
    assert.equal(st.diagrams.blueprintChanged, false);
    const set = (await get(b.port, '/api/diagrams')).json();
    assert.equal(set.source, 'drawn');
    assert.deepEqual(set.bundle, bundle());

    const frame = await get(b.port, '/diagrams-frame');
    assert.equal(frame.status, 200);
    const csp = frame.headers['content-security-policy'];
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /script-src 'self' 'nonce-/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    assert.match(csp, /connect-src 'self'/);
    assert.doesNotMatch(csp, /https?:/, 'the diagram page reaches nothing but the board');
    assert.equal(frame.headers['x-frame-options'], 'SAMEORIGIN');
    assert.match(frame.text, new RegExp(`/assets/mermaid-${MERMAID_VERSION.replace(/\./g, '\\.')}\\.js`));
    assert.match(frame.text, /securityLevel: 'strict'/);
    const fscript = frame.text.split(/<script nonce="[^"]+">/)[1].split('</script>')[0];
    assert.doesNotThrow(() => new Function(fscript));
  });

  test('the renderer route answers a Genesis error, not a script, when no checked renderer is available', async () => {
    const bogus = path.join(tempDir(), 'mermaid.js');
    fs.writeFileSync(bogus, 'alert(1)');
    const p = project();
    const b = await ensureBoard({ env: envFor({ GENESIS_MERMAID_FILE: bogus }), project: p });
    const res = await get(b.port, `/assets/mermaid-${MERMAID_VERSION}.js`);
    assert.equal(res.status, 503);
    assert.equal(res.json().error.code, 'GENESIS_BOARD_NO_RENDERER');
    assert.match(res.json().error.message, /sha256 differs/);
  });
});

describe('the renderer cache', () => {
  const bytes = Buffer.from('// a stand-in renderer\n');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const fetchOf = (answers) => {
    const seen = [];
    const impl = async (url) => {
      seen.push(url);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return { ok: a.status === 200, status: a.status, arrayBuffer: async () => a.body };
    };
    return { impl, seen };
  };

  test('downloads once from the first mirror that serves the pinned bytes, keeps them, then reads the cache', async () => {
    const env = envFor();
    const f = fetchOf([new Error('offline'), { status: 200, body: Buffer.from('tampered') }, { status: 200, body: bytes }]);
    await assert.rejects(mermaidScript(env, { fetchImpl: f.impl, urls: ['https://a.example/m.js', 'https://b.example/m.js'], sha }), (e) => {
      assert.match(e.message, /a\.example: offline/);
      assert.match(e.message, /b\.example: sha256 differs/);
      return true;
    });
    assert.equal(fs.existsSync(mermaidCacheFile(env)), false, 'nothing unchecked is kept');
    const got = await mermaidScript(env, { fetchImpl: f.impl, urls: ['https://c.example/m.js'], sha });
    assert.deepEqual(got, bytes);
    assert.deepEqual(fs.readFileSync(mermaidCacheFile(env)), bytes);
    const none = fetchOf([]);
    assert.deepEqual(await mermaidScript(env, { fetchImpl: none.impl, sha }), bytes);
    assert.equal(none.seen.length, 0, 'the cache answers without the network');
  });

  test('a cached file that no longer matches is fetched again; GENESIS_MERMAID_FILE is checked too', async () => {
    const env = envFor();
    fs.mkdirSync(path.dirname(mermaidCacheFile(env)), { recursive: true });
    fs.writeFileSync(mermaidCacheFile(env), 'changed');
    const f = fetchOf([{ status: 200, body: bytes }]);
    assert.deepEqual(await mermaidScript(env, { fetchImpl: f.impl, urls: ['https://a.example/m.js'], sha }), bytes);
    assert.equal(f.seen.length, 1);
    const local = path.join(tempDir(), 'm.js');
    fs.writeFileSync(local, bytes);
    assert.deepEqual(await mermaidScript({ ...env, GENESIS_MERMAID_FILE: local }, { fetchImpl: fetchOf([]).impl, sha }), bytes);
    fs.writeFileSync(local, 'other');
    await assert.rejects(mermaidScript({ ...env, GENESIS_MERMAID_FILE: local }, { sha }), /GENESIS_MERMAID_FILE/);
  });
});
