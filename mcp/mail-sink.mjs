// The board's mail sink (#9389, epic #9384): the local counterpart of the mail
// sink a generated service falls back to when it has no complete email provider.
//
// A generated service sends every mail it cannot deliver (verification codes,
// password resets, notifications) and every SMS without an SMS provider to the
// SMTP host MAILSINK_HOST:MAILSINK_PORT (default mail-sink:465, cleartext). On a
// developer machine nothing listens there. While `genesis board` runs, this sink
// listens on 127.0.0.1:10465 (GENESIS_MAILSINK_PORT moves it), accepts any
// credentials or none, and stores each message under the project in the user's
// home (<data>/projects/<id>/mail/, newest MAX_MESSAGES kept), where the board's
// Mail tab shows it. Run the services with MAILSINK_HOST=127.0.0.1
// MAILSINK_PORT=10465 and every mail and SMS lands there.
//
// Deliberately small: SMTP without TLS (the services dial it in cleartext),
// AUTH PLAIN / LOGIN accepted whatever the credentials, one message at a time
// per connection, MIME read only far enough to show subject, recipients and a
// text body (multipart, base64, quoted-printable, encoded-word headers).

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { projectDataDir } from './project.mjs';

export const MAILSINK_PORT = 10465;
const PORT_TRIES = 10;
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGES = 200;

export function mailDir(env, projectId) {
  return path.join(projectDataDir(env, projectId), 'mail');
}

// ── MIME, as far as the board needs it ─────────────────────────────

function decodeQP(text) {
  const bytes = [];
  const s = text.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(s[i], 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** RFC 2047 encoded words in a header value. */
export function decodeHeader(value) {
  return String(value ?? '')
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _charset, enc, data) => {
      try {
        return enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64').toString('utf8') : decodeQP(data.replace(/_/g, ' '));
      } catch {
        return data;
      }
    });
}

function splitHead(raw) {
  const at = raw.search(/\r?\n\r?\n/);
  if (at < 0) return { head: raw, body: '' };
  const sep = raw.slice(at).match(/^\r?\n\r?\n/)[0];
  return { head: raw.slice(0, at), body: raw.slice(at + sep.length) };
}

function parseHeaders(head) {
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
  }
  return headers;
}

function param(value, name) {
  const m = String(value ?? '').match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return m ? m[1] ?? m[2] : null;
}

function decodeBody(body, encoding) {
  const enc = String(encoding ?? '').toLowerCase();
  if (enc === 'base64') {
    try {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return body;
    }
  }
  if (enc === 'quoted-printable') return decodeQP(body);
  return body;
}

/** The text and HTML bodies of a (possibly multipart) MIME entity. */
function bodies(raw, depth = 0) {
  const { head, body } = splitHead(raw);
  const h = parseHeaders(head);
  const type = String(h['content-type'] ?? 'text/plain').toLowerCase();
  const out = { text: null, html: null };
  if (type.startsWith('multipart/') && depth < 5) {
    const boundary = param(h['content-type'], 'boundary');
    if (!boundary) return out;
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break;
      // The line break before the next boundary belongs to the boundary, not the part.
      const b = bodies(part.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), depth + 1);
      out.text ??= b.text;
      out.html ??= b.html;
    }
    return out;
  }
  const decoded = decodeBody(body, h['content-transfer-encoding']);
  if (type.startsWith('text/html')) out.html = decoded;
  else if (type.startsWith('text/')) out.text = decoded;
  return out;
}

/** HTML to readable text, for a mail that has no text part. */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Codes a person would copy out of a mail: 4 to 8 digits standing alone. */
export function codesIn(text) {
  // Not a piece of a date, time, version or number: no digit, #, -, /, : or . on either side.
  return [...new Set(String(text).match(/(?<![\d#\-/:.])\b\d{4,8}\b(?![\d\-/:.])/g) ?? [])].slice(0, 5);
}

/** One received message as the board stores it. */
export function parseMessage(raw, envelope = {}) {
  const { head } = splitHead(raw);
  const h = parseHeaders(head);
  const b = bodies(raw);
  const text = b.text ?? (b.html ? htmlToText(b.html) : '');
  const to = envelope.to?.length ? envelope.to : String(h.to ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sms = to.some((t) => /^sms-[^@]*@sms-sink\.invalid$/i.test(t.replace(/^.*</, '').replace(/>.*$/, '')));
  return {
    from: decodeHeader(h.from ?? envelope.from ?? ''),
    to: to.map(decodeHeader),
    subject: decodeHeader(h.subject ?? ''),
    date: h.date ?? null,
    kind: sms ? 'sms' : 'mail',
    text: text.slice(0, 200_000),
    hasHtml: Boolean(b.html),
    codes: codesIn(`${decodeHeader(h.subject ?? '')}\n${text}`),
    size: Buffer.byteLength(raw),
  };
}

// ── storage ─────────────────────────────────────────────────────────

function store(env, projectId, message) {
  const dir = mailDir(env, projectId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const receivedAt = new Date().toISOString();
  const id = `${receivedAt.replace(/[-:.TZ]/g, '')}-${randomBytes(4).toString('hex')}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, receivedAt, ...message }), { mode: 0o600 });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_MESSAGES))) fs.rmSync(path.join(dir, old), { force: true });
  return id;
}

/** The stored messages, newest first, without their bodies. */
export function listMail(env, projectId) {
  const dir = mailDir(env, projectId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ id: m.id, receivedAt: m.receivedAt, from: m.from, to: m.to, subject: m.subject, kind: m.kind, codes: m.codes });
    } catch {
      // a half-written or foreign file: skip it
    }
  }
  return out;
}

export function readMail(env, projectId, id) {
  if (!/^[0-9]{17}-[0-9a-f]{8}$/.test(String(id))) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(mailDir(env, projectId), `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export function clearMail(env, projectId) {
  fs.rmSync(mailDir(env, projectId), { recursive: true, force: true });
}

// ── the SMTP server ─────────────────────────────────────────────────

function session(socket, onMessage) {
  socket.setEncoding('utf8');
  socket.setTimeout(60_000, () => socket.destroy());
  const reply = (line) => socket.write(`${line}\r\n`);
  let buf = '';
  let mode = 'command'; // command | data | auth-login-user | auth-login-pass
  let envelope = { from: null, to: [] };
  let data = [];
  let size = 0;
  reply('220 genesis board mail sink ESMTP ready');
  socket.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (mode === 'data') {
        if (line === '.') {
          mode = 'command';
          if (size > MAX_MESSAGE_BYTES) reply('552 message too large for the mail sink');
          else {
            try {
              onMessage(data.join('\r\n'), envelope);
              reply('250 stored in the genesis board mail sink');
            } catch {
              reply('451 the mail sink could not store the message');
            }
          }
          envelope = { from: null, to: [] };
          data = [];
          size = 0;
        } else {
          size += line.length + 2;
          if (size <= MAX_MESSAGE_BYTES) data.push(line.startsWith('..') ? line.slice(1) : line);
        }
        continue;
      }
      if (mode === 'auth-login-user') {
        mode = 'auth-login-pass';
        reply('334 UGFzc3dvcmQ6');
        continue;
      }
      if (mode === 'auth-login-pass') {
        mode = 'command';
        reply('235 accepted (the mail sink takes any credentials)');
        continue;
      }
      const [verb, ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          socket.write('250-genesis board mail sink\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 5242880\r\n250 8BITMIME\r\n');
          break;
        case 'HELO':
          reply('250 genesis board mail sink');
          break;
        case 'AUTH':
          if (/^LOGIN/i.test(arg)) {
            mode = arg.split(' ').length > 1 ? 'auth-login-pass' : 'auth-login-user';
            reply(mode === 'auth-login-user' ? '334 VXNlcm5hbWU6' : '334 UGFzc3dvcmQ6');
          } else if (/^PLAIN\s+\S/i.test(arg)) reply('235 accepted (the mail sink takes any credentials)');
          else if (/^PLAIN$/i.test(arg)) {
            mode = 'auth-login-pass';
            reply('334 ');
          } else reply('504 the mail sink takes PLAIN or LOGIN');
          break;
        case 'MAIL':
          envelope = { from: (arg.match(/<([^>]*)>/) ?? [])[1] ?? '', to: [] };
          reply('250 ok');
          break;
        case 'RCPT':
          envelope.to.push((arg.match(/<([^>]*)>/) ?? [])[1] ?? arg);
          reply('250 ok');
          break;
        case 'DATA':
          if (!envelope.to.length) reply('503 RCPT TO first');
          else {
            mode = 'data';
            reply('354 end the message with a line holding only "."');
          }
          break;
        case 'RSET':
          envelope = { from: null, to: [] };
          reply('250 ok');
          break;
        case 'NOOP':
          reply('250 ok');
          break;
        case 'QUIT':
          reply('221 bye');
          socket.end();
          return;
        case 'STARTTLS':
          reply('502 the mail sink is cleartext only (MAILSINK_SECURE must stay false)');
          break;
        default:
          reply('502 command not implemented by the mail sink');
      }
    }
  });
  socket.on('error', () => {});
}

let current = null; // { server, port, projectId, env }

/**
 * Starts this process's mail sink for a project (or answers the running one).
 * Answers `{ host, port }`, or null when no port in the range was free.
 */
export async function ensureMailSink({ env = process.env, project }) {
  if (current && current.server.listening && current.projectId === project.id && current.env === env) {
    return { host: '127.0.0.1', port: current.port };
  }
  if (current) await closeMailSink();
  const base = Number.parseInt(env.GENESIS_MAILSINK_PORT ?? '', 10) || MAILSINK_PORT;
  const server = net.createServer((socket) => session(socket, (raw, envelope) => store(env, project.id, parseMessage(raw, envelope))));
  for (let port = base; port < base + PORT_TRIES; port++) {
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) {
      server.unref();
      current = { server, port, projectId: project.id, env };
      return { host: '127.0.0.1', port };
    }
  }
  return null;
}

export async function closeMailSink() {
  const s = current;
  current = null;
  if (!s) return;
  await new Promise((resolve) => s.server.close(() => resolve()));
}

export function mailSinkAddress() {
  return current ? { host: '127.0.0.1', port: current.port } : null;
}
