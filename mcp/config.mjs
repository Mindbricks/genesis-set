// Where the genesis-set MCP server finds the Genesis API key and the API base.
//
// The key comes from the environment (GENESIS_API_KEY) or from the genesis-set
// config file in the user's home (<data>/config.json, <data> = GENESIS_SET_HOME
// or ~/.genesis-set). Nothing is ever read from the current folder or a project
// folder: a key there would end up in a commit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const API_KEY_ENV = 'GENESIS_API_KEY';
export const API_BASE_ENV = 'GENESIS_API_BASE';
export const DEFAULT_API_BASE = 'https://api.genesiscompiler.com';
/** Every endpoint lives below this path of the API base. */
export const API_PATH = '/genesis/compiler/v1';
/** The Genesis portal page where a user creates an API key (shown once). */
export const PORTAL_KEYS_URL = 'https://portal.genesiscompiler.com/keys';
const STAGE_API_HOST = 'sapi.genesiscompiler.com';
const STAGE_PORTAL_KEYS_URL = 'https://stage.genesiscompiler.com/keys';

/** The keys page of the portal that belongs to an API base: the stage API has its own portal. */
export function portalKeysUrl(apiBase) {
  try {
    if (apiBase && new URL(apiBase).hostname === STAGE_API_HOST) return STAGE_PORTAL_KEYS_URL;
  } catch {
    // not a URL: the prod portal
  }
  return PORTAL_KEYS_URL;
}
export const CONFIG_FILE = 'config.json';
/** The server's default inline-blueprint limit (bytes of the compact JSON text). */
export const DEFAULT_MAX_BLUEPRINT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;

/** The genesis-set data folder: GENESIS_SET_HOME, else ~/.genesis-set. */
export function dataDirOf(env = process.env) {
  if (env.GENESIS_SET_HOME) return path.resolve(env.GENESIS_SET_HOME);
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, '.genesis-set');
}

export function configPathOf(env = process.env) {
  return path.join(dataDirOf(env), CONFIG_FILE);
}

/** The config file as an object; `{}` when it is absent, `{ __error }` when it cannot be read. */
export function readConfigFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return e && e.code === 'ENOENT' ? {} : { __error: `cannot read ${file}: ${e.message}` };
  }
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { __error: `${file} is not a JSON object` };
  } catch {
    return { __error: `${file} is not valid JSON` };
  }
}

/** Writes the config file with owner-only permissions (0600), creating the folder (0700). */
export function writeConfigFile(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: no POSIX modes
  }
}

function isLoopback(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || h.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * The API base as a URL string without a trailing slash and without the API
 * path. A plain-http base is allowed only on a loopback address, so the key is
 * never sent in clear text over a network. Throws on a bad value.
 */
export function normalizeApiBase(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error(`"${raw}" is not a URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`"${raw}" is not an http(s) URL`);
  if (u.protocol === 'http:' && !isLoopback(u.hostname)) {
    throw new Error(`"${raw}" uses plain http on a non-local host; use https`);
  }
  if (u.search || u.hash) throw new Error(`"${raw}" must not carry a query or a fragment`);
  let p = u.pathname.replace(/\/+$/, '');
  if (p.endsWith(API_PATH)) p = p.slice(0, -API_PATH.length);
  return `${u.origin}${p}`;
}

function positiveInt(raw, fallback) {
  const n = raw === undefined || raw === null || raw === '' ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Everything a call needs, resolved from the environment and the config file:
 * `{ apiKey, keySource, apiBase, baseSource, configFile, maxBlueprintBytes,
 * timeoutMs, problems }`. `apiKey` is null when no key is set, `apiBase` null
 * when the configured base is not usable; `problems` lists what could not be
 * used (a broken config file, a bad base URL).
 */
export function resolveSettings(env = process.env) {
  const configFile = configPathOf(env);
  const cfg = readConfigFile(configFile);
  const problems = [];
  if (cfg.__error) problems.push(cfg.__error);
  let apiKey = null;
  let keySource = null;
  const envKey = typeof env[API_KEY_ENV] === 'string' ? env[API_KEY_ENV].trim() : '';
  if (envKey) {
    apiKey = envKey;
    keySource = API_KEY_ENV;
  } else if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) {
    apiKey = cfg.apiKey.trim();
    keySource = configFile;
  }
  let apiBase = DEFAULT_API_BASE;
  let baseSource = 'default';
  const rawBase = env[API_BASE_ENV] ? env[API_BASE_ENV] : typeof cfg.apiBase === 'string' && cfg.apiBase ? cfg.apiBase : null;
  if (rawBase) {
    try {
      apiBase = normalizeApiBase(rawBase);
      baseSource = env[API_BASE_ENV] ? API_BASE_ENV : configFile;
    } catch (e) {
      // Never fall back to another host: the key would go somewhere the user did not pick.
      apiBase = null;
      baseSource = env[API_BASE_ENV] ? API_BASE_ENV : configFile;
      problems.push(`API base ${e.message} (set in ${baseSource})`);
    }
  }
  return {
    apiKey,
    keySource,
    apiBase,
    baseSource,
    configFile,
    maxBlueprintBytes: positiveInt(env.GENESIS_MAX_BLUEPRINT_BYTES ?? cfg.maxBlueprintBytes, DEFAULT_MAX_BLUEPRINT_BYTES),
    timeoutMs: positiveInt(env.GENESIS_TIMEOUT_MS ?? cfg.timeoutMs, DEFAULT_TIMEOUT_MS),
    problems,
  };
}

/** The one message for a missing key: where to create it, how to set it, and where never to put it. */
export function missingKeyMessage(configFile, apiBase) {
  return (
    `No Genesis API key is set. The user creates one on the Genesis portal (${portalKeysUrl(apiBase)}; ` +
    'it is shown once) and sets it in the environment the agent starts from ' +
    `(export ${API_KEY_ENV}=<your key>), or store it once with "genesis config set-key" ` +
    `(it reads the key from stdin and writes ${configFile}, readable only by you). ` +
    'Never put the key in the project folder, the blueprint, a commit or the chat. ' +
    'The config file is read on every call; a new environment variable needs an agent restart.'
  );
}
