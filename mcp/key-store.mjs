// The local key store of genesis-set (#9352): the keys a coding agent needs (the
// Genesis API key, provider keys for the generated services), kept in the
// genesis config file (<data>/config.json, mode 0600) next to the API key.
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

import { API_KEY_ENV, configPathOf, maskSecret, readConfigFile, writeConfigFile } from './config.mjs';
import { projectKeysFile } from './project.mjs';

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

/**
 * Where a scope's keys live. `global`: the genesis-set config file. `project`:
 * the project's keys file under the user's home (never the project folder);
 * it needs the project (`findProject`).
 */
export const SCOPES = ['project', 'global'];

function checkScope(scope, project) {
  if (!SCOPES.includes(scope)) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', `scope must be one of: ${SCOPES.join(', ')}`);
  if (scope === 'project' && !project) {
    throw new KeyStoreError('GENESIS_KEY_NO_PROJECT', 'this folder is not a genesis project; run "genesis init" here, or use the global scope', 409);
  }
}

function load(env, scope = 'global', project = null) {
  checkScope(scope, project);
  const file = scope === 'project' ? projectKeysFile(env, project.id) : configPathOf(env);
  const cfg = readConfigFile(file);
  if (cfg.__error) throw new KeyStoreError('GENESIS_KEY_STORE_UNREADABLE', `${cfg.__error}; fix or delete it first`, 500);
  const keys = cfg.keys && typeof cfg.keys === 'object' && !Array.isArray(cfg.keys) ? { ...cfg.keys } : {};
  return { file, cfg, keys, scope };
}

function save({ file, cfg, keys, scope }) {
  const next = { ...cfg, keys };
  if (Object.keys(keys).length === 0 && scope !== 'project') delete next.keys;
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

function row(name, entry, { builtin = false, envOverride = false, envValue = null, scope = 'global' } = {}) {
  const value = typeof entry.value === 'string' && entry.value ? entry.value : null;
  // The key in effect: for the Genesis API key the environment variable wins over the file.
  return {
    name,
    label: entry.label || name,
    description: entry.description || '',
    builtin,
    scope,
    status: value || envOverride ? 'set' : 'empty',
    ...(envOverride ? { source: API_KEY_ENV } : {}),
    masked: maskSecret(envOverride ? envValue : value),
    updatedAt: entry.updatedAt ?? null,
  };
}

/**
 * Every key, the built-in Genesis API key first. `masked` (the type prefix and
 * the last four characters, see maskSecret) is for the page; the tools drop it.
 */
export function listKeys(env = process.env, { project = null } = {}) {
  const { cfg, keys } = load(env);
  const envKey = typeof env[API_KEY_ENV] === 'string' && env[API_KEY_ENV].trim() !== '';
  const rows = [
    row(
      BUILTIN_KEY,
      { label: BUILTIN_LABEL, description: BUILTIN_DESCRIPTION, value: cfg.apiKey, updatedAt: cfg.apiKeyUpdatedAt },
      { builtin: true, envOverride: envKey, envValue: envKey ? env[API_KEY_ENV] : null },
    ),
  ];
  if (project) {
    const p = load(env, 'project', project);
    for (const name of Object.keys(p.keys).sort()) {
      if (!KEY_NAME_PATTERN.test(name) || name === BUILTIN_KEY) continue;
      const e = p.keys[name];
      if (e && typeof e === 'object') rows.push(row(name, e, { scope: 'project' }));
    }
  }
  for (const name of Object.keys(keys).sort()) {
    if (!KEY_NAME_PATTERN.test(name) || name === BUILTIN_KEY) continue;
    const e = keys[name];
    if (e && typeof e === 'object') rows.push(row(name, e));
  }
  return rows;
}

/** A key's row: in `scope` when given, else the project's first, then the global one. */
export function findKey(env, name, { scope, project = null } = {}) {
  const rows = listKeys(env, { project }).filter((k) => k.name === name);
  if (scope) return rows.find((k) => k.scope === scope) ?? null;
  return rows.find((k) => k.scope === 'project') ?? rows.find((k) => k.scope === 'global') ?? null;
}

/**
 * Registers a key (or updates its label and description); an existing value is
 * kept. The built-in key is only reported.
 */
export function requestKey(env, { name, label, description }, { scope = 'global', project = null } = {}) {
  checkKeyName(name);
  if (name === BUILTIN_KEY) return findKey(env, name, { scope: 'global', project });
  const l = cleanText(label, MAX_LABEL, 'label');
  const d = cleanText(description, MAX_DESCRIPTION, 'description');
  const store = load(env, scope, project);
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
  return findKey(env, name, { scope, project });
}

export function setKeyValue(env, name, value, { scope = 'global', project = null } = {}) {
  checkKeyName(name);
  const v = checkValue(value);
  if (name === BUILTIN_KEY) scope = 'global';
  const store = load(env, scope, project);
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
  return findKey(env, name, { scope, project });
}

export function clearKeyValue(env, name, { scope = 'global', project = null } = {}) {
  checkKeyName(name);
  if (name === BUILTIN_KEY) scope = 'global';
  const store = load(env, scope, project);
  if (name === BUILTIN_KEY) {
    store.cfg = { ...store.cfg, apiKey: undefined, apiKeyUpdatedAt: undefined };
  } else {
    const prev = store.keys[name];
    if (!prev || typeof prev !== 'object') throw new KeyStoreError('GENESIS_KEY_NOT_FOUND', `no key named "${name}"`, 404);
    const { value: _dropped, ...rest } = prev;
    store.keys[name] = { ...rest, updatedAt: now() };
  }
  save(store);
  return findKey(env, name, { scope, project });
}

export function deleteKey(env, name, { scope = 'global', project = null } = {}) {
  checkKeyName(name);
  if (name === BUILTIN_KEY) {
    throw new KeyStoreError('GENESIS_KEY_BUILTIN', 'the Genesis API key cannot be deleted; clear its value instead');
  }
  const store = load(env, scope, project);
  if (!(name in store.keys)) throw new KeyStoreError('GENESIS_KEY_NOT_FOUND', `no key named "${name}"`, 404);
  delete store.keys[name];
  save(store);
}

/** A stored value, for the code that uses the key. Never put it in a tool answer. */
export function keyValue(env, name, { project = null } = {}) {
  checkKeyName(name);
  if (project && name !== BUILTIN_KEY) {
    const p = load(env, 'project', project).keys[name];
    if (p && typeof p === 'object' && typeof p.value === 'string' && p.value) return p.value;
  }
  const { cfg, keys } = load(env);
  if (name === BUILTIN_KEY) {
    const fromEnv = typeof env[API_KEY_ENV] === 'string' ? env[API_KEY_ENV].trim() : '';
    return fromEnv || (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) || null;
  }
  const e = keys[name];
  return e && typeof e === 'object' && typeof e.value === 'string' && e.value ? e.value : null;
}
