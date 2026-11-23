// genesis_deliverService and its parts: the tar reader, the manifest rule that
// applies a build archive to a local service folder, and the tool end to end
// against a stub Genesis API (bearer link and presigned link).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import zlib from 'node:zlib';

import { applyDelivery, gitBlobId, planDelivery } from '../mcp/deliver.mjs';
import { ArchiveError, readTar, readTarGz, safeRelativePath } from '../mcp/tar-read.mjs';
import { PKG_DIR, cleanup, makeHome, tempDir } from './helpers.mjs';

after(cleanup);

// ── a minimal ustar + pax writer (the framework writes the real ones) ──

function header(name, size, type, mode = 0o644) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
function tar(entries) {
  const parts = [];
  for (const e of entries) {
    const data = e.type === '5' ? Buffer.alloc(0) : Buffer.from(e.data ?? '');
    if (Buffer.byteLength(e.path) > 100) {
      const rec = (len) => `${len} path=${e.path}\n`;
      let len = Buffer.byteLength(rec(0));
      while (Buffer.byteLength(rec(len)) !== len) len = Buffer.byteLength(rec(len));
      const pax = Buffer.from(rec(len));
      parts.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    parts.push(header(e.path, data.length, e.type ?? '0', e.mode), pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const manifestOf = (files) =>
  JSON.stringify({ schema: 'genesis-manifest/1', note: 'n', hash: 'git-blob', files: Object.fromEntries(Object.entries(files).map(([p, d]) => [p, gitBlobId(Buffer.from(d))])) });
/** A build archive: the generated files plus their manifest. */
function buildArchive(files) {
  const entries = Object.entries(files).map(([p, d]) => ({ path: p, data: d, mode: p.endsWith('.sh') ? 0o755 : 0o644 }));
  entries.push({ path: '.genesis/manifest.json', data: manifestOf(files) });
  return zlib.gzipSync(tar(entries));
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

describe('the tar reader', () => {
  test('files, folders, a pax long path, an executable bit; links are skipped, not written', () => {
    const long = `${'deep/'.repeat(30)}file.ts`;
    const { entries, skipped } = readTar(
      tar([
        { path: 'src', type: '5', mode: 0o755 },
        { path: 'src/a.ts', data: 'A' },
        { path: long, data: 'L' },
        { path: 'run.sh', data: '#!/bin/sh', mode: 0o755 },
        { path: 'link', type: '2' },
      ]),
    );
    assert.deepEqual(entries.map((e) => [e.path, e.type]), [['src', 'dir'], ['src/a.ts', 'file'], [long, 'file'], ['run.sh', 'file']]);
    assert.equal(entries[2].data.toString(), 'L');
    assert.equal(entries[3].mode & 0o111, 0o111);
    assert.deepEqual(skipped, ['link']);
  });

  test('an unsafe path makes the whole archive invalid; damage and a bad gzip are clear errors', () => {
    for (const bad of ['../x', '/etc/x', 'a/../../x', 'C:/x', 'a\\b', 'a//b', './x']) {
      assert.throws(() => safeRelativePath(bad), ArchiveError, bad);
    }
    assert.throws(() => readTar(tar([{ path: 'ok', data: '1' }, { path: '../evil', data: '2' }])), /unsafe path/);
    const t = tar([{ path: 'a', data: 'x' }]);
    t[0] ^= 1;
    assert.throws(() => readTar(t), /checksum/);
    assert.throws(() => readTarGz(Buffer.from('not gzip')), /not a readable gzip/);
    assert.throws(() => readTar(tar([{ path: 'big', data: 'x'.repeat(100) }]), { maxBytes: 10 }), /more than 10 bytes/);
  });
});

describe('the manifest rule', () => {
  const apply = (target, files) => {
    const plan = planDelivery(readTarGz(buildArchive(files)).entries, target);
    applyDelivery(plan, target);
    return plan;
  };

  test('a first delivery writes the tree and keeps the user\'s files; a path the tree generates is overwritten', () => {
    const t = tempDir();
    fs.mkdirSync(path.join(t, '.git'));
    fs.writeFileSync(path.join(t, '.git', 'HEAD'), 'ref');
    fs.writeFileSync(path.join(t, 'NOTES.md'), 'mine');
    fs.writeFileSync(path.join(t, 'package.json'), 'old');
    const plan = apply(t, { 'package.json': '{}', 'src/index.ts': 'v1', 'run.sh': 'x' });
    assert.equal(plan.firstDelivery, true);
    assert.equal(read(t, 'src/index.ts'), 'v1');
    assert.equal(read(t, 'NOTES.md'), 'mine');
    assert.equal(read(t, '.git/HEAD'), 'ref');
    assert.deepEqual(plan.editedOverwritten, ['package.json'], 'a user file at a generated path is reported');
    assert.ok(fs.existsSync(path.join(t, '.genesis', 'manifest.json')));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(t, 'run.sh')).mode & 0o111, 0o111);
  });

  test('the next delivery: rewrites generated files, deletes the ones no longer generated, keeps edits and user files', () => {
    const t = tempDir();
    apply(t, { 'src/a.ts': 'a1', 'src/gone.ts': 'g1', 'src/old/edited.ts': 'e1', 'src/same.ts': 's' });
    fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'a1 + my edit');
    fs.writeFileSync(path.join(t, 'src', 'old', 'edited.ts'), 'e1 + my edit');
    fs.mkdirSync(path.join(t, 'service-files'));
    fs.writeFileSync(path.join(t, 'service-files', 'logo.png'), 'png');
    fs.writeFileSync(path.join(t, 'mine.ts'), 'mine');
    const plan = apply(t, { 'src/a.ts': 'a2', 'src/same.ts': 's', 'src/new.ts': 'n', 'service-files/logo.png': 'generated' });
    assert.equal(plan.firstDelivery, false);
    assert.equal(read(t, 'src/a.ts'), 'a2');
    assert.deepEqual(plan.editedOverwritten, ['src/a.ts']);
    assert.deepEqual(plan.remove, ['src/gone.ts']);
    assert.equal(fs.existsSync(path.join(t, 'src', 'gone.ts')), false);
    assert.deepEqual(plan.keptEdited, ['src/old/edited.ts'], 'a no-longer-generated file the user edited stays');
    assert.equal(read(t, 'src/old/edited.ts'), 'e1 + my edit');
    assert.equal(read(t, 'service-files/logo.png'), 'png', 'service-files is always the user\'s');
    assert.deepEqual(plan.skippedCustomer, ['service-files/logo.png']);
    assert.equal(read(t, 'mine.ts'), 'mine');
    assert.equal(plan.unchanged, 1);
    assert.equal(read(t, 'src/new.ts'), 'n');
  });

  test('the user\'s service-files/ bytes survive the first delivery and every re-delivery', () => {
    // A build archive carries no service-file bytes (they are the user's): it
    // holds the accessor and the Dockerfile that expect them under service-files/.
    const t = tempDir();
    fs.mkdirSync(path.join(t, 'service-files', 'public', 'legal'), { recursive: true });
    fs.mkdirSync(path.join(t, 'service-files', 'private'), { recursive: true });
    fs.writeFileSync(path.join(t, 'service-files', 'public', 'legal', 'terms.md'), '# Terms\n');
    fs.writeFileSync(path.join(t, 'service-files', 'private', 'rates.json'), '{"vat":20}');
    const generated = { 'src/service-files/index.ts': 'accessor v1', Dockerfile: 'COPY service-files ./service-files', 'src/old.ts': 'o' };
    const first = apply(t, generated);
    assert.equal(first.firstDelivery, true);
    assert.equal(read(t, 'service-files/public/legal/terms.md'), '# Terms\n');
    assert.equal(read(t, 'service-files/private/rates.json'), '{"vat":20}');
    assert.deepEqual(first.editedOverwritten, [], 'no user file is reported as overwritten');

    // A re-delivery that changes and drops generated files keeps them too.
    const next = apply(t, { 'src/service-files/index.ts': 'accessor v2', Dockerfile: 'COPY service-files ./service-files' });
    assert.deepEqual(next.remove, ['src/old.ts']);
    assert.equal(read(t, 'service-files/public/legal/terms.md'), '# Terms\n');
    assert.equal(read(t, 'service-files/private/rates.json'), '{"vat":20}');

    // Even a previous manifest that listed a service file with its current
    // bytes (an older build that shipped them) never makes a later delivery
    // delete it.
    const listed = apply(t, { 'src/service-files/index.ts': 'accessor v2', Dockerfile: 'COPY service-files ./service-files', 'service-files/public/legal/terms.md': '# Terms\n' });
    assert.deepEqual(listed.skippedCustomer, ['service-files/public/legal/terms.md']);
    const dropped = apply(t, { 'src/service-files/index.ts': 'accessor v3' });
    assert.deepEqual(dropped.remove, ['Dockerfile']);
    assert.equal(read(t, 'service-files/public/legal/terms.md'), '# Terms\n');
    assert.equal(read(t, 'service-files/private/rates.json'), '{"vat":20}');
  });

  test('an empty folder left by a deleted file goes; an archive without a manifest is refused', () => {
    const t = tempDir();
    apply(t, { 'src/x/only.ts': '1', 'keep.ts': 'k' });
    apply(t, { 'keep.ts': 'k' });
    assert.equal(fs.existsSync(path.join(t, 'src')), false);
    assert.throws(() => planDelivery(readTar(tar([{ path: 'a', data: '1' }])).entries, t), /no \.genesis\/manifest\.json/);
  });
});

// ── the tool end to end ──

const API = '/genesis/compiler/v1';
const KEY = 'fake-key-bbbb';
const SERVER = path.join(PKG_DIR, 'mcp', 'server.mjs');
let stub;
let archive;
let link;
before(async () => {
  stub = http.createServer((req, res) => {
    const send = (s, j) => {
      res.writeHead(s, { 'content-type': 'application/json' });
      res.end(JSON.stringify(j));
    };
    if (req.url === `${API}/jobs/j1/archive`) return send(200, { archive: link() });
    if (req.url === `${API}/jobs/j2/archive`) return send(403, { error: { code: 'GENESIS_DELIVERY_NOT_ENABLED', message: 'off' } });
    if (req.url === `${API}/jobs/j1/archive/content`) {
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { code: 'GENESIS_UNAUTHENTICATED', message: 'no' } });
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archive.length });
      return res.end(archive);
    }
    if (req.url === '/presigned/obj') {
      if (req.headers.authorization) return send(400, { error: { code: 'X', message: 'a presigned link must not get the key' } });
      res.writeHead(200, { 'content-type': 'application/gzip' });
      return res.end(archive);
    }
    send(404, { error: { code: 'GENESIS_NOT_FOUND', message: 'nf' } });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
});
after(() => new Promise((r) => stub.close(r)));
const base = () => `http://127.0.0.1:${stub.address().port}`;

function mcp(cwd, home) {
  const child = spawn(process.execPath, [SERVER], { cwd, env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, GENESIS_API_BASE: base(), GENESIS_API_KEY: KEY }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let id = 1;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const n = id++;
      waiting.set(n, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    });
  return {
    async call(name, args) {
      const m = await request('tools/call', { name, arguments: args });
      return { isError: m.result.isError, data: JSON.parse(m.result.content[0].text) };
    },
    init: () => request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
    close: () => new Promise((r) => { child.on('exit', r); child.stdin.end(); }),
  };
}

describe('genesis_deliverService', () => {
  test('downloads through the API (bearer) or a presigned link (no key), checks sha256, applies into <project>/<root>; dryRun writes nothing', async () => {
    archive = buildArchive({ 'src/index.ts': 'v1', 'package.json': '{}' });
    const sha = createHash('sha256').update(archive).digest('hex');
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.genesis'));
    fs.writeFileSync(path.join(root, '.genesis', 'project.json'), JSON.stringify({ id: 'proj-1234abcd', name: 'shop' }));
    const s = mcp(root, makeHome());
    await s.init();
    try {
      link = () => ({ url: '/jobs/j1/archive/content', auth: 'bearer', sha256: sha, bytes: archive.length, root: 'shop-orders-service', format: 'tar.gz' });
      const dry = await s.call('genesis_deliverService', { jobId: 'j1', dryRun: true });
      assert.equal(dry.isError, false, JSON.stringify(dry.data));
      assert.equal(dry.data.delivery.applied, false);
      assert.equal(dry.data.delivery.newFiles, 3);
      const target = path.join(root, 'shop-orders-service');
      assert.equal(fs.existsSync(target), false, 'a dry run writes nothing');

      const done = await s.call('genesis_deliverService', { jobId: 'j1' });
      assert.equal(done.data.delivery.applied, true);
      assert.equal(read(target, 'src/index.ts'), 'v1');
      assert.equal(JSON.stringify(done.data).includes('v1'), false, 'no file content in the answer');

      archive = buildArchive({ 'src/index.ts': 'v2' });
      const sha2 = createHash('sha256').update(archive).digest('hex');
      link = () => ({ url: `${base()}/presigned/obj`, auth: 'none', sha256: sha2, bytes: archive.length, root: 'shop-orders-service', format: 'tar.gz' });
      const again = await s.call('genesis_deliverService', { jobId: 'j1' });
      assert.equal(again.isError, false, JSON.stringify(again.data));
      assert.deepEqual(again.data.delivery.deleted, ['package.json']);
      assert.equal(read(target, 'src/index.ts'), 'v2');

      link = () => ({ url: '/jobs/j1/archive/content', auth: 'bearer', sha256: '0'.repeat(64), bytes: 1, root: 'shop-orders-service', format: 'tar.gz' });
      const corrupt = await s.call('genesis_deliverService', { jobId: 'j1' });
      assert.equal(corrupt.data.error.code, 'GENESIS_ARCHIVE_CORRUPT');
      assert.equal(read(target, 'src/index.ts'), 'v2');

      link = () => ({ url: 'http://example.com/x', auth: 'none', sha256: sha, bytes: 1, root: 'shop-orders-service' });
      assert.equal((await s.call('genesis_deliverService', { jobId: 'j1' })).data.error.code, 'GENESIS_BAD_RESPONSE', 'plain http off localhost is refused');
      link = () => ({ url: '/jobs/j1/archive/content', auth: 'bearer', sha256: sha, bytes: 1, root: '../escape' });
      assert.equal((await s.call('genesis_deliverService', { jobId: 'j1' })).data.error.code, 'GENESIS_BAD_RESPONSE', 'a root that is not a folder name is refused');

      assert.equal((await s.call('genesis_deliverService', { jobId: 'j2' })).data.error.code, 'GENESIS_DELIVERY_NOT_ENABLED');
    } finally {
      await s.close();
    }
  });
});
