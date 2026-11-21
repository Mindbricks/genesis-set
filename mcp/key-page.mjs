// The local key manager page (#9352): a small HTTP server inside the MCP
// server process where the user enters, changes and deletes the keys of the
// genesis-set key store. The agent never sees a value; it only hands the user
// the page's link.
//
// - Bound to 127.0.0.1 on a random port; nothing else can reach it.
// - Every request carries the page's random token (the `t` query of the link,
//   then the X-Genesis-Key-Token header); the token dies with the page.
// - The Host header must be this page's own address (DNS rebinding), and every
//   write must come from the page itself (Origin) with a JSON body (CSRF).
// - The page closes after IDLE_MS without a request, and when the MCP server
//   ends; the next key tool call opens a new one with a new link.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { KeyStoreError, clearKeyValue, deleteKey, listKeys, requestKey, setKeyValue } from './key-store.mjs';
import { renderKeyPage } from './key-page-html.mjs';

export const IDLE_MS = 15 * 60 * 1000;
const MAX_BODY = 32 * 1024;
const TOKEN_HEADER = 'x-genesis-key-token';

let current = null; // { server, port, token, timer, env, idleMs, closed, resolveClosed }

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function securityHeaders(res, nonce) {
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

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

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

/** The page's own addresses: what Host and Origin may say. */
function ownHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

async function handle(page, req, res) {
  const nonce = randomBytes(16).toString('base64');
  securityHeaders(res, nonce);
  const hosts = ownHosts(page.port);
  if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {
    sendError(res, 421, 'GENESIS_KEY_PAGE_HOST', 'this page answers only on its own local address');
    return;
  }
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${page.port}`);
  const isPage = req.method === 'GET' && url.pathname === '/';
  const token = isPage ? url.searchParams.get('t') : req.headers[TOKEN_HEADER];
  if (!sameToken(token, page.token)) {
    if (isPage) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderKeyPage({ nonce, expired: true }));
      return;
    }
    sendError(res, 403, 'GENESIS_KEY_PAGE_TOKEN', 'the page link has expired; ask the agent for a new one');
    return;
  }
  touch(page);
  if (isPage) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderKeyPage({ nonce, idleMinutes: Math.round(page.idleMs / 60000) }));
    return;
  }
  if (req.method !== 'GET') {
    const origin = String(req.headers.origin ?? '').toLowerCase();
    if (!origin || !hosts.has(origin.replace(/^http:\/\//, ''))) {
      sendError(res, 403, 'GENESIS_KEY_PAGE_ORIGIN', 'writes are accepted only from the key page itself');
      return;
    }
    if (req.method !== 'DELETE' && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      sendError(res, 415, 'GENESIS_KEY_BAD_INPUT', 'send JSON');
      return;
    }
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] !== 'api' || parts[1] !== 'keys') return sendError(res, 404, 'GENESIS_KEY_PAGE_NOT_FOUND', 'no such page');
    const [, , name, sub] = parts;
    if (req.method === 'GET' && !name) return sendJson(res, 200, { keys: listKeys(page.env) });
    if (req.method === 'POST' && !name) {
      const b = await readJson(req);
      return sendJson(res, 200, { key: requestKey(page.env, { name: b.name, label: b.label, description: b.description }) });
    }
    if (name && sub === 'value' && req.method === 'PUT') {
      const b = await readJson(req);
      return sendJson(res, 200, { key: setKeyValue(page.env, name, b.value) });
    }
    if (name && sub === 'value' && req.method === 'DELETE') return sendJson(res, 200, { key: clearKeyValue(page.env, name) });
    if (name && !sub && req.method === 'DELETE') {
      deleteKey(page.env, name);
      return sendJson(res, 200, { deleted: name });
    }
    if (name && !sub && req.method === 'PATCH') {
      const b = await readJson(req);
      return sendJson(res, 200, { key: requestKey(page.env, { name, label: b.label, description: b.description }) });
    }
    return sendError(res, 405, 'GENESIS_KEY_PAGE_METHOD', 'not supported');
  } catch (err) {
    if (err instanceof KeyStoreError) return sendError(res, err.status, err.code, err.message);
    return sendError(res, 500, 'GENESIS_KEY_PAGE_ERROR', 'the key page could not complete the request');
  }
}

function touch(page) {
  clearTimeout(page.timer);
  page.timer = setTimeout(() => closeKeyPage(), page.idleMs);
  page.timer.unref?.();
}

/**
 * The running page, or a new one. Answers `{ url, port, expiresAfterIdleMinutes }`.
 * `env` is the environment the store resolves its file from (tests).
 */
export async function ensureKeyPage({ env = process.env, idleMs = IDLE_MS } = {}) {
  if (current && current.server.listening && current.env === env) {
    touch(current);
    return linkOf(current);
  }
  if (current) await closeKeyPage();
  const page = { token: randomBytes(24).toString('base64url'), env, idleMs, port: 0, timer: null, server: null };
  page.closed = new Promise((r) => {
    page.resolveClosed = r;
  });
  page.server = http.createServer((req, res) => {
    handle(page, req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, 'GENESIS_KEY_PAGE_ERROR', 'the key page could not complete the request');
    });
  });
  page.server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => {
    page.server.once('error', reject);
    page.server.listen(0, '127.0.0.1', resolve);
  });
  page.server.unref();
  page.port = page.server.address().port;
  current = page;
  touch(page);
  return linkOf(page);
}

function linkOf(page) {
  return {
    url: `http://127.0.0.1:${page.port}/?t=${page.token}`,
    port: page.port,
    expiresAfterIdleMinutes: Math.round(page.idleMs / 60000),
  };
}

/** Closes the page; its link stops working. */
export async function closeKeyPage() {
  const page = current;
  current = null;
  if (!page) return;
  clearTimeout(page.timer);
  await new Promise((resolve) => {
    page.server.close(() => resolve());
    page.server.closeAllConnections?.();
  });
  page.resolveClosed();
}

/** Resolves when the running page closes (idle, or closeKeyPage); at once when none runs. */
export function keyPageClosed() {
  return current ? current.closed : Promise.resolve();
}
