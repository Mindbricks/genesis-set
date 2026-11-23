// A small reader for the build archives Genesis hands out (POSIX ustar, pax
// extended headers for long or non-ASCII paths, gzip outside). No dependency:
// genesis-set ships without node_modules.
//
// Only regular files and folders come out. Any other entry (link, device,
// fifo) is listed in `skipped` and never written. A path that could leave the
// target folder (absolute, a drive letter, a `..` segment, a backslash, a NUL)
// makes the whole archive invalid: nothing of it is applied.

import zlib from 'node:zlib';

export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArchiveError';
  }
}

const BLOCK = 512;

function field(buf, off, len) {
  const raw = buf.subarray(off, off + len);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? len : nul).toString('utf8');
}

function octal(buf, off, len) {
  const s = field(buf, off, len).trim();
  if (s === '') return 0;
  if (!/^[0-7]+$/.test(s)) throw new ArchiveError(`a header field is not octal: "${s}"`);
  return Number.parseInt(s, 8);
}

function checksumOk(header) {
  const stored = octal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum === stored;
}

/** `path=...` records of a pax extended header. */
function paxRecords(data) {
  const out = {};
  let i = 0;
  const text = data.toString('utf8');
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp === -1) break;
    const len = Number.parseInt(text.slice(i, sp), 10);
    if (!Number.isFinite(len) || len <= 0) throw new ArchiveError('a pax header record is malformed');
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/** A repo-relative POSIX path that stays inside the target, or throws. */
export function safeRelativePath(p) {
  const s = String(p).replace(/\/+$/, '');
  if (!s || s.includes('\0') || s.includes('\\') || s.startsWith('/') || /^[A-Za-z]:/.test(s)) {
    throw new ArchiveError(`the archive holds an unsafe path: ${JSON.stringify(p)}`);
  }
  const parts = s.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) throw new ArchiveError(`the archive holds an unsafe path: ${JSON.stringify(p)}`);
  return parts.join('/');
}

/**
 * The entries of a tar buffer: `{ entries: [{ path, type: 'file' | 'dir', mode, data }], skipped: [path] }`.
 * `maxBytes` caps the sum of the file sizes.
 */
export function readTar(buf, { maxBytes = 250 * 1024 * 1024 } = {}) {
  const entries = [];
  const skipped = [];
  let off = 0;
  let total = 0;
  let pax = null;
  let longName = null;
  while (off + BLOCK <= buf.length) {
    const header = buf.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (!checksumOk(header)) throw new ArchiveError('the archive is damaged (a header checksum does not match)');
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new ArchiveError('the archive is truncated');
    const data = buf.subarray(dataStart, dataEnd);
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') {
      pax = paxRecords(data);
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    let p = pax?.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    pax = null;
    longName = null;
    if (type === '0' || type === '\0' || type === '7') {
      total += size;
      if (total > maxBytes) throw new ArchiveError(`the archive unpacks to more than ${maxBytes} bytes`);
      p = safeRelativePath(p);
      entries.push({ path: p, type: 'file', mode: octal(header, 100, 8), data: Buffer.from(data) });
    } else if (type === '5') {
      entries.push({ path: safeRelativePath(p), type: 'dir', mode: octal(header, 100, 8), data: null });
    } else {
      skipped.push(p);
    }
  }
  return { entries, skipped };
}

/** gunzip + readTar, both capped. */
export function readTarGz(gz, { maxBytes = 250 * 1024 * 1024 } = {}) {
  let tar;
  try {
    tar = zlib.gunzipSync(gz, { maxOutputLength: maxBytes + 64 * 1024 * 1024 });
  } catch (e) {
    throw new ArchiveError(`the archive is not a readable gzip file (${e.code ?? e.message})`);
  }
  return readTar(tar, { maxBytes });
}
