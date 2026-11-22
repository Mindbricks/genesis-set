// The project board server (#9386, epic #9384): one local page per genesis
// project with its design flow, documents, interview, blueprint and keys.
//
// - 127.0.0.1 on a fixed default port (BOARD_PORT, or GENESIS_BOARD_PORT; then the next ones), so the
//   board can be bookmarked. A second `genesis board` (or the agent) for the same
//   project finds the running board through /api/whoami and reuses it.
// - Reading needs no token: the page and /api/* GETs answer anyone on this
//   machine who uses the board's own address (Host check against DNS rebinding;
//   no CORS, so another site cannot read the answers).
// - Writing (keys) needs the run's write cookie, set when the board is opened
//   with its write link (`genesis board`, the agent's link): HttpOnly,
//   SameSite=Strict, named per port. Every write also needs the board's own
//   Origin and a JSON body.
// - The run's token sits in <data>/board/<port>.json (0600) while the board runs,
//   so a second process can hand out a write link to the running board.
// - The board closes after IDLE_MS without a request (an open page polls, so it
//   stays up while someone looks at it) and when its process ends.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { dataDirOf } from './config.mjs';
import { blueprintModule, boardState, designDoc } from './board-data.mjs';
import { renderBoardPage } from './board-html.mjs';
import { renderMarkdown } from './board-md.mjs';
import { KeyStoreError, SCOPES, clearKeyValue, deleteKey, requestKey, setKeyValue } from './key-store.mjs';
import { clearMail, listMail, readMail } from './mail-view.mjs';

export const BOARD_PORT = 4747;
const PORT_TRIES = 20;
export const BOARD_IDLE_MS = 60 * 60 * 1000;
const MAX_BODY = 32 * 1024;

let current = null; // { server, port, token, project, env, idleMs, timer, tokenFile, closed, resolveClosed }

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const cookieName = (port) => `genesis_board_${port}`;

function cookieOf(req, port) {
  const header = String(req.headers.cookie ?? '');
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === cookieName(port)) return v.join('=');
  }
  return null;
}

function headers(res, nonce) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; ` +
      "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const sendError = (res, status, code, message) => sendJson(res, status, { error: { code, message } });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new KeyStoreError('GENESIS_KEY_BAD_INPUT', 'the request body is too large', 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new KeyStoreError('GENESIS_KEY_BAD_INPUT', 'the request body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

const ownHosts = (port) => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

function touch(board) {
  clearTimeout(board.timer);
  board.timer = setTimeout(() => closeBoard(), board.idleMs);
  board.timer.unref?.();
}

async function handle(board, req, res) {
  const nonce = randomBytes(16).toString('base64');
  headers(res, nonce);
  const hosts = ownHosts(board.port);
  if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {
    return sendError(res, 421, 'GENESIS_BOARD_HOST', 'the board answers only on its own local address');
  }
  touch(board);
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${board.port}`);
  const canWrite = sameToken(cookieOf(req, board.port), board.token);

  if (req.method === 'GET' && url.pathname === '/') {
    const t = url.searchParams.get('t');
    if (t !== null) {
      // The write link: set the write cookie when the token is right, then drop the token from the address.
      if (sameToken(t, board.token)) {
        res.setHeader('Set-Cookie', `${cookieName(board.port)}=${board.token}; HttpOnly; SameSite=Strict; Path=/`);
      }
      res.statusCode = 303;
      res.setHeader('Location', `/${url.hash}`);
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(renderBoardPage({ nonce, projectName: board.project.name }));
  }

  if (req.method === 'GET' && url.pathname === '/api/whoami') {
    return sendJson(res, 200, { app: 'genesis-board', projectId: board.project.id, dataDir: dataDirOf(board.env) });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const state = await boardState({ env: board.env, project: board.project });
    // The mail sink is infrastructure (Mailpit); the board only reads it (#9392).
    return sendJson(res, 200, { ...state, mail: await listMail(board.env), canWrite });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/mail/')) {
    const m = await readMail(board.env, decodeURIComponent(url.pathname.slice('/api/mail/'.length)));
    if (!m) return sendError(res, 404, 'GENESIS_BOARD_NO_MAIL', 'no such message');
    return sendJson(res, 200, { message: m });
  }
  if (req.method === 'DELETE' && url.pathname === '/api/mail') {
    if (!canWrite) return sendError(res, 403, 'GENESIS_BOARD_READ_ONLY', 'this board is read-only here; open it with "genesis board" to clear the mail');
    const origin = String(req.headers.origin ?? '').toLowerCase();
    if (!origin || !hosts.has(origin.replace(/^http:\/\//, ''))) return sendError(res, 403, 'GENESIS_BOARD_ORIGIN', 'writes are accepted only from the board itself');
    try {
      await clearMail(board.env);
    } catch (e) {
      return sendError(res, 502, 'GENESIS_BOARD_MAIL_SINK', `the mail sink did not clear: ${e.message}`);
    }
    return sendJson(res, 200, { cleared: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/blueprint') {
    const m = await blueprintModule(board.env, board.project, url.searchParams.get('path') ?? '$');
    if (!m) return sendError(res, 404, 'GENESIS_BOARD_NO_MODULE', 'no such part of blueprint.json');
    return sendJson(res, 200, { module: m });
  }
  if (req.method === 'GET' && url.pathname === '/api/doc') {
    const name = url.searchParams.get('name') ?? '';
    const text = designDoc(board.project, name);
    if (text === null) return sendError(res, 404, 'GENESIS_BOARD_NO_DOC', 'no such design document');
    return sendJson(res, 200, { name, html: renderMarkdown(text) });
  }

  if (url.pathname.startsWith('/api/keys')) {
    if (req.method === 'GET') return sendError(res, 405, 'GENESIS_BOARD_METHOD', 'read the keys from /api/state');
    if (!canWrite) return sendError(res, 403, 'GENESIS_BOARD_READ_ONLY', 'this board is read-only here; open it with "genesis board" to change keys');
    const origin = String(req.headers.origin ?? '').toLowerCase();
    if (!origin || !hosts.has(origin.replace(/^http:\/\//, ''))) {
      return sendError(res, 403, 'GENESIS_BOARD_ORIGIN', 'writes are accepted only from the board itself');
    }
    if (req.method !== 'DELETE' && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return sendError(res, 415, 'GENESIS_KEY_BAD_INPUT', 'send JSON');
    }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // api, keys, scope?, name?, value?
    const [, , scope, name, sub] = parts;
    const where = { scope, project: board.project };
    try {
      if (req.method === 'POST' && !scope) {
        const b = await readJson(req);
        const s = SCOPES.includes(b.scope) ? b.scope : 'project';
        return sendJson(res, 200, { key: requestKey(board.env, { name: b.name, label: b.label, description: b.description }, { scope: s, project: board.project }) });
      }
      if (!SCOPES.includes(scope) || !name) return sendError(res, 404, 'GENESIS_BOARD_NOT_FOUND', 'no such key path');
      if (sub === 'value' && req.method === 'PUT') {
        const b = await readJson(req);
        return sendJson(res, 200, { key: setKeyValue(board.env, name, b.value, where) });
      }
      if (sub === 'value' && req.method === 'DELETE') return sendJson(res, 200, { key: clearKeyValue(board.env, name, where) });
      if (!sub && req.method === 'DELETE') {
        deleteKey(board.env, name, where);
        return sendJson(res, 200, { deleted: name, scope });
      }
      if (!sub && req.method === 'PATCH') {
        const b = await readJson(req);
        return sendJson(res, 200, { key: requestKey(board.env, { name, label: b.label, description: b.description }, where) });
      }
      return sendError(res, 405, 'GENESIS_BOARD_METHOD', 'not supported');
    } catch (err) {
      if (err instanceof KeyStoreError) return sendError(res, err.status, err.code, err.message);
      throw err;
    }
  }
  return sendError(res, 404, 'GENESIS_BOARD_NOT_FOUND', 'no such page');
}

function tokenFileOf(env, port) {
  return path.join(dataDirOf(env), 'board', `${port}.json`);
}

/** Asks a running board on `port` who it is; null when nothing (or something else) answers. */
function whoami(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/whoami', headers: { host: `127.0.0.1:${port}` }, timeout: 1500 }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(text);
          resolve(j && j.app === 'genesis-board' ? j : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function linksOf(port, token) {
  return {
    url: token ? `http://127.0.0.1:${port}/?t=${token}` : `http://127.0.0.1:${port}/`,
    readUrl: `http://127.0.0.1:${port}/`,
    port,
  };
}

function listen(server, port) {
  return new Promise((resolve) => {
    const onError = (e) => {
      server.off('listening', onListening);
      resolve(e.code === 'EADDRINUSE' || e.code === 'EACCES' ? false : Promise.reject(e));
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * The board of `project`: this process's running one, a running one of another
 * process (found on the ports), or a new one. Answers `{ url, readUrl, port,
 * reused, idleMinutes }`; `url` carries the write token when it is known.
 */
export async function ensureBoard({ env = process.env, project, idleMs = BOARD_IDLE_MS, basePort } = {}) {
  basePort = basePort ?? (Number.parseInt(env.GENESIS_BOARD_PORT ?? '', 10) || BOARD_PORT);
  if (!project) throw new Error('the board needs a genesis project ("genesis init" makes one)');
  if (current && current.server.listening && current.project.id === project.id && current.env === env) {
    touch(current);
    return { ...linksOf(current.port, current.token), reused: true, idleMinutes: Math.round(current.idleMs / 60000) };
  }
  if (current) await closeBoard();
  const board = { token: randomBytes(24).toString('base64url'), env, project, idleMs, port: 0, timer: null, server: null };
  board.closed = new Promise((r) => {
    board.resolveClosed = r;
  });
  board.server = http.createServer((req, res) => {
    handle(board, req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, 'GENESIS_BOARD_ERROR', 'the board could not complete the request');
    });
  });
  board.server.keepAliveTimeout = 1000;
  for (let port = basePort; port < basePort + PORT_TRIES; port++) {
    if (await listen(board.server, port)) {
      board.port = port;
      break;
    }
    const other = await whoami(port);
    if (other && other.projectId === project.id && other.dataDir === dataDirOf(env)) {
      let token = null;
      try {
        token = JSON.parse(fs.readFileSync(tokenFileOf(env, port), 'utf8')).token ?? null;
      } catch {
        // the running board did not leave its token: the link is read-only
      }
      return { ...linksOf(port, token), reused: true, idleMinutes: null };
    }
  }
  if (!board.port) throw new Error(`no free port for the board between ${basePort} and ${basePort + PORT_TRIES - 1}`);
  board.server.unref();
  board.tokenFile = tokenFileOf(env, board.port);
  try {
    fs.mkdirSync(path.dirname(board.tokenFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(board.tokenFile, JSON.stringify({ token: board.token, pid: process.pid, projectId: project.id }), { mode: 0o600 });
  } catch {
    board.tokenFile = null; // the board still works; another process just cannot hand out its write link
  }
  current = board;
  touch(board);
  return { ...linksOf(board.port, board.token), reused: false, idleMinutes: Math.round(idleMs / 60000) };
}

/** Closes this process's board; its links stop working and its token file goes. */
export async function closeBoard() {
  const board = current;
  current = null;
  if (!board) return;
  clearTimeout(board.timer);
  if (board.tokenFile) fs.rmSync(board.tokenFile, { force: true });
  await new Promise((resolve) => {
    board.server.close(() => resolve());
    board.server.closeAllConnections?.();
  });
  board.resolveClosed();
}

/** Resolves when this process's board closes; at once when none runs. */
export function boardClosed() {
  return current ? current.closed : Promise.resolve();
}
