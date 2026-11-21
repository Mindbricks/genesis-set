// Reads a blueprint (or one service's fragment) from the user's disk for an
// inline request. The size is checked here, against the server's limit, before
// anything is sent: the API measures the compact JSON text of the object, so
// that is what is measured locally too. Only the parsed object leaves this
// module; the file path is never sent.

import fs from 'node:fs';
import path from 'node:path';

import { genesisError } from './client.mjs';

/** A file this many times the limit is refused before it is read (pretty-printed JSON is larger than compact). */
const RAW_FACTOR = 8;

export class LocalBlueprintError extends Error {
  constructor(code, message, details) {
    super(message);
    this.body = genesisError(code, message, details);
  }
}

/**
 * The JSON object in `file` (absolute, or relative to the folder the MCP
 * server was started in). `kind` is "blueprint" or "fragment".
 * Throws LocalBlueprintError.
 */
export function readLocalJson(file, { maxBytes, kind = 'blueprint', cwd = process.cwd() }) {
  if (typeof file !== 'string' || !file.trim()) {
    throw new LocalBlueprintError('GENESIS_BAD_ARGUMENTS', `The ${kind} path must be a non-empty string`);
  }
  const abs = path.resolve(cwd, file.trim());
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new LocalBlueprintError('GENESIS_BLUEPRINT_FILE_NOT_FOUND', `No ${kind} file at ${abs}`, { path: abs });
  }
  if (!st.isFile()) throw new LocalBlueprintError('GENESIS_BLUEPRINT_FILE_NOT_FOUND', `${abs} is not a file`, { path: abs });
  if (st.size > maxBytes * RAW_FACTOR) {
    throw new LocalBlueprintError(
      'GENESIS_BLUEPRINT_TOO_LARGE',
      `The ${kind} file ${abs} is ${st.size} bytes; the Genesis limit is ${maxBytes} bytes of compact JSON. Nothing was sent.`,
      { path: abs, fileBytes: st.size, limit: maxBytes, checkedLocally: true },
    );
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new LocalBlueprintError('GENESIS_BLUEPRINT_FILE_INVALID', `${abs} is not valid JSON: ${e.message}`, { path: abs });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalBlueprintError('GENESIS_BLUEPRINT_FILE_INVALID', `${abs} must hold one JSON object (the ${kind})`, { path: abs });
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > maxBytes) {
    throw new LocalBlueprintError(
      'GENESIS_BLUEPRINT_TOO_LARGE',
      `The ${kind} is ${bytes} bytes of compact JSON; the Genesis limit is ${maxBytes}. Nothing was sent.`,
      { path: abs, bytes, limit: maxBytes, checkedLocally: true },
    );
  }
  return value;
}
