// The local key store of genesis-set (#9352): the keys a coding agent needs (the
// Genesis API key, provider keys for the generated services), kept in the
// genesis-set config file (<data>/config.json, mode 0600) next to the API key.
//
//   apiKey                 the Genesis API key; shown as the built-in key
//                          "genesis-api-key"
//   keys.<name>            { label, description, value?, createdAt, updatedAt }
//
// The agent registers a key by name with a readable label and a description;
// the user enters the value on the local key page (./key-page.mjs). Nothing in
// this module returns a value to the agent: `listKeys` answers set / empty and
// the last four characters for the page, and `keyValue` is for the code that
// uses a key (writing a gitignored env file), never for a tool answer.

import { API_KEY_ENV, configPathOf, readConfigFile, writeConfigFile } from './config.mjs';

export const BUILTIN_KEY = 'genesis-api-key';
const BUILTIN_LABEL = 'Genesis API key';
const BUILTIN_DESCRIPTION =
  'Authenticates the genesis_* tools with the Genesis Compiler API. Create it on the Genesis portal (API keys page); it is shown once.';

/** A key name: lowercase kebab-case, 2 to 64 characters, starting with a letter. */
export const KEY_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const MAX_LABEL = 80;
const MAX_DESCRIPTION = 500;
const MAX_VALUE = 16 * 1024;

/** A refusal the tools and the page turn into a Genesis error. */
export class KeyStoreError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function now() {
  return new Date().toISOString();
}

function load(env) {
  const file = configPathOf(env);
  const cfg = readConfigFile(file);
  if (cfg.__error) throw new KeyStoreError('GENESIS_KEY_STORE_UNREADABLE', `${cfg.__error}; fix or delete it first`, 500);
  const keys = cfg.keys && typeof cfg.keys === 'object' && !Array.isArray(cfg.keys) ? { ...cfg.keys } : {};
  return { file, cfg, keys };
}

function save({ file, cfg, keys }) {
  const next = { ...cfg, keys };
  if (Object.keys(keys).length === 0) delete next.keys;
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  writeConfigFile(file, next);
}

function cleanText(v, max, what) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', `${what} must be a string`);
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', `${what} is longer than ${max} characters`);
  return t;
}

export function checkKeyName(name) {
  if (typeof name !== 'string' || !KEY_NAME_PATTERN.test(name)) {
    throw new KeyStoreError(
      'GENESIS_KEY_NAME_INVALID',
      `"${String(name).slice(0, 80)}" is not a key name: lowercase letters, digits and dashes, 2 to 64 characters, starting with a letter (for example "stripe-secret-key")`,
    );
  }
  return name;
}

function checkValue(value) {
  if (typeof value !== 'string') throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', 'the value must be a string');
  const v = value.trim();
  if (!v) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', 'the value is empty');
  if (v.length > MAX_VALUE) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', `the value is longer than ${MAX_VALUE} characters`);
  if (/[\u0000\r\n]/.test(v)) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', 'the value must be one line');
  return v;
}

/** The last four characters, for a long value only (a short one would give most of it away). */
function tailOf(value) {
  return typeof value === 'string' && value.length >= 12 ? value.slice(-4) : null;
}

function row(name, entry, { builtin = false, envOverride = false } = {}) {
  const value = typeof entry.value === 'string' && entry.value ? entry.value : null;
  return {
    name,
    label: entry.label || name,
    description: entry.description || '',
    builtin,
    status: value || envOverride ? 'set' : 'empty',
    ...(envOverride ? { source: API_KEY_ENV } : {}),
    tail: tailOf(value),
    updatedAt: entry.updatedAt ?? null,
  };
}

/**
 * Every key, the built-in Genesis API key first. `tail` (the last four
 * characters) is for the page; the tools drop it.
 */
export function listKeys(env = process.env) {
  const { cfg, keys } = load(env);
  const envKey = typeof env[API_KEY_ENV] === 'string' && env[API_KEY_ENV].trim() !== '';
  const rows = [
    row(
      BUILTIN_KEY,
      { label: BUILTIN_LABEL, description: BUILTIN_DESCRIPTION, value: cfg.apiKey, updatedAt: cfg.apiKeyUpdatedAt },
      { builtin: true, envOverride: envKey },
    ),
  ];
  for (const name of Object.keys(keys).sort()) {
    if (!KEY_NAME_PATTERN.test(name) || name === BUILTIN_KEY) continue;
    const e = keys[name];
    if (e && typeof e === 'object') rows.push(row(name, e));
  }
  return rows;
}

export function findKey(env, name) {
  return listKeys(env).find((k) => k.name === name) ?? null;
}

/**
 * Registers a key (or updates its label and description); an existing value is
 * kept. The built-in key is only reported.
 */
export function requestKey(env, { name, label, description }) {
  checkKeyName(name);
  if (name === BUILTIN_KEY) return findKey(env, name);
  const l = cleanText(label, MAX_LABEL, 'label');
  const d = cleanText(description, MAX_DESCRIPTION, 'description');
  const store = load(env);
  const prev = store.keys[name] && typeof store.keys[name] === 'object' ? store.keys[name] : null;
  const at = now();
  store.keys[name] = {
    label: l || prev?.label || name,
    description: d ?? prev?.description ?? '',
    ...(prev?.value ? { value: prev.value } : {}),
    createdAt: prev?.createdAt ?? at,
    updatedAt: prev ? prev.updatedAt ?? at : at,
  };
  save(store);
  return findKey(env, name);
}

export function setKeyValue(env, name, value) {
  checkKeyName(name);
  const v = checkValue(value);
  const store = load(env);
  const at = now();
  if (name === BUILTIN_KEY) {
    if (/\s/.test(v)) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', 'the Genesis API key must not contain whitespace');
    store.cfg = { ...store.cfg, apiKey: v, apiKeyUpdatedAt: at };
  } else {
    const prev = store.keys[name];
    if (!prev || typeof prev !== 'object') throw new KeyStoreError('GENESIS_KEY_NOT_FOUND', `no key named "${name}"`, 404);
    store.keys[name] = { ...prev, value: v, updatedAt: at };
  }
  save(store);
  return findKey(env, name);
}

export function clearKeyValue(env, name) {
  checkKeyName(name);
  const store = load(env);
  if (name === BUILTIN_KEY) {
    store.cfg = { ...store.cfg, apiKey: undefined, apiKeyUpdatedAt: undefined };
  } else {
    const prev = store.keys[name];
    if (!prev || typeof prev !== 'object') throw new KeyStoreError('GENESIS_KEY_NOT_FOUND', `no key named "${name}"`, 404);
    const { value: _dropped, ...rest } = prev;
    store.keys[name] = { ...rest, updatedAt: now() };
  }
  save(store);
  return findKey(env, name);
}

export function deleteKey(env, name) {
  checkKeyName(name);
  if (name === BUILTIN_KEY) {
    throw new KeyStoreError('GENESIS_KEY_BUILTIN', 'the Genesis API key cannot be deleted; clear its value instead');
  }
  const store = load(env);
  if (!(name in store.keys)) throw new KeyStoreError('GENESIS_KEY_NOT_FOUND', `no key named "${name}"`, 404);
  delete store.keys[name];
  save(store);
}

/** A stored value, for the code that uses the key. Never put it in a tool answer. */
export function keyValue(env, name) {
  checkKeyName(name);
  const { cfg, keys } = load(env);
  if (name === BUILTIN_KEY) {
    const fromEnv = typeof env[API_KEY_ENV] === 'string' ? env[API_KEY_ENV].trim() : '';
    return fromEnv || (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) || null;
  }
  const e = keys[name];
  return e && typeof e === 'object' && typeof e.value === 'string' && e.value ? e.value : null;
}
