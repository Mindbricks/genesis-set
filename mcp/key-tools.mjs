// The key tools of the genesis-set MCP server (#9352). They manage the local
// key store (./key-store.mjs) through the local key page (./key-page.mjs) and
// never put a key's value into an answer: the agent asks for a key, hands the
// user the page link, and sees only whether the key is set.
//
//   genesis_requestKey         register a key (empty) and answer the page link
//   genesis_listKeys           every key: name, label, description, set / empty
//   genesis_openKeyManager     the page link, to manage every key
//   genesis_writeKeyToEnvFile  copy a stored value into a gitignored env file
//
// They work without a Genesis API key: the first one is how the user sets it.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { genesisError } from './client.mjs';
import { ensureKeyPage } from './key-page.mjs';
import { BUILTIN_KEY, KeyStoreError, checkKeyName, findKey, keyValue, listKeys, requestKey } from './key-store.mjs';

const KEY_NAME = {
  type: 'string',
  description: `The key's name: lowercase kebab-case, for example "stripe-secret-key". "${BUILTIN_KEY}" is the Genesis API key itself.`,
};
const OPEN = {
  type: 'boolean',
  description: "Also open the page in the user's default browser on this machine (default false). Only when the user agreed.",
};

export const KEY_TOOLS = [
  {
    name: 'genesis_requestKey',
    title: 'Ask the user for a key on the local key page',
    description:
      'Register a key the work needs (a provider secret, the Genesis API key) as an empty entry with a readable label and a description, ' +
      'and get the link of the local key page where the user enters it. Give the user the link and ask them to save the key there, then check with genesis_listKeys. ' +
      'Never ask for a key value in the chat. An entry that already exists keeps its value.',
    inputSchema: {
      type: 'object',
      properties: {
        name: KEY_NAME,
        label: { type: 'string', description: 'A human-readable name shown on the page, for example "Stripe secret key (test mode)".' },
        description: {
          type: 'string',
          description: 'What the key is for and where the user gets it, shown on the page (for example "Stripe dashboard, Developers > API keys; a test-mode key starting sk_test_").',
        },
        open: OPEN,
      },
      required: ['name', 'label'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'genesis_listKeys',
    title: 'List the keys of the local key store',
    description: 'Every key of the local key store with its label, description and status (set or empty). Values are never answered.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'genesis_openKeyManager',
    title: 'Open the local key page',
    description: 'The link of the local key page, where the user adds, changes and deletes keys. The link works on this machine only and expires when idle.',
    inputSchema: { type: 'object', properties: { open: OPEN }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'genesis_writeKeyToEnvFile',
    title: 'Write a stored key into a gitignored env file',
    description:
      'Copy a stored key into an env file of a generated service (for example its .dev.secrets.env) as VARIABLE=value, without the value passing through the agent. ' +
      'Only a file named .env, .env.local or *.secrets.env is accepted, and inside a git repository only one that git ignores and does not track. The answer never carries the value.',
    inputSchema: {
      type: 'object',
      properties: {
        name: KEY_NAME,
        file: { type: 'string', description: 'The env file (absolute, or relative to the folder the agent was started in).' },
        variable: { type: 'string', description: 'The variable name in the file, for example STRIPE_SECRET_KEY.' },
      },
      required: ['name', 'file', 'variable'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const KEY_TOOL_NAMES = new Set(KEY_TOOLS.map((t) => t.name));

export function isKeyTool(name) {
  return KEY_TOOL_NAMES.has(name);
}

/** A row for the agent: the page's row without the value's tail. */
function forAgent(row) {
  if (!row) return row;
  const { tail: _tail, ...rest } = row;
  return rest;
}

export function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const ENV_FILE_NAME = /^(\.env|\.env\.local|\.[A-Za-z0-9._-]*secrets\.env|[A-Za-z0-9._-]+\.secrets\.env)$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  return r.error ? null : r;
}

/** Why a file may not receive a key, or null. Inside a git work tree it must be ignored and untracked. */
function envFileRefusal(file) {
  if (!ENV_FILE_NAME.test(path.basename(file))) {
    return `${path.basename(file)} is not an env file genesis-set writes keys into (.env, .env.local or *.secrets.env)`;
  }
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return `the folder ${dir} does not exist`;
  const inside = git(dir, ['rev-parse', '--is-inside-work-tree']);
  if (!inside || inside.status !== 0 || inside.stdout.trim() !== 'true') return null; // not a repository: nothing to commit it into
  const tracked = git(dir, ['ls-files', '--error-unmatch', '--', path.basename(file)]);
  if (tracked && tracked.status === 0) return `${file} is tracked by git; a key never goes into a committed file`;
  const ignored = git(dir, ['check-ignore', '-q', '--', path.basename(file)]);
  if (!ignored || ignored.status !== 0) return `${file} is not ignored by git; add it to .gitignore first so the key cannot be committed`;
  return null;
}

/** VALUE as an env-file value: bare when it is plain, else double-quoted with \ and " escaped. */
function envValue(v) {
  return /^[A-Za-z0-9_./:@+=,-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function writeEnvVariable(file, variable, value) {
  let text = '';
  let created = false;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    created = true;
  }
  const line = `${variable}=${envValue(value)}`;
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${variable}\\s*=`).test(l));
  const replaced = at >= 0;
  if (replaced) lines[at] = line;
  else lines.push(line);
  const tmp = `${file}.genesis-set.${process.pid}.tmp`;
  let mode = 0o600;
  if (!created) {
    try {
      mode = fs.statSync(file).mode & 0o777;
    } catch {
      // keep 0600
    }
  }
  fs.writeFileSync(tmp, `${lines.join('\n')}\n`, { mode });
  fs.renameSync(tmp, file);
  return { created, replaced };
}

async function pageLink(settings, open) {
  const link = await ensureKeyPage({ env: settings.env ?? process.env });
  const opened = open === true ? openInBrowser(link.url) : false;
  return { ...link, opened };
}

const HANDLERS = {
  async genesis_requestKey(args, settings) {
    const env = settings.env ?? process.env;
    const key = forAgent(requestKey(env, { name: args.name, label: args.label, description: args.description }));
    const link = await pageLink(settings, args.open);
    return {
      key,
      keyPage: link,
      next:
        key.status === 'set'
          ? `"${key.label}" is already set. Use it; the user can change it on the key page.`
          : `Ask the user to open ${link.url} on this machine and save "${key.label}" there, then call genesis_listKeys to see it set. ` +
            'Never ask for the value in the chat. Later the user can open the page themselves with "genesis keys" in a terminal.',
    };
  },
  async genesis_listKeys(_args, settings) {
    return { keys: listKeys(settings.env ?? process.env).map(forAgent) };
  },
  async genesis_openKeyManager(args, settings) {
    return { keyPage: await pageLink(settings, args.open) };
  },
  async genesis_writeKeyToEnvFile(args, settings) {
    const env = settings.env ?? process.env;
    checkKeyName(args.name);
    if (!VARIABLE.test(args.variable)) throw new KeyStoreError('GENESIS_KEY_BAD_INPUT', `"${args.variable}" is not an env variable name`);
    const row = findKey(env, args.name);
    if (!row) throw new KeyStoreError('GENESIS_KEY_NOT_FOUND', `no key named "${args.name}"; register it with genesis_requestKey`, 404);
    const value = keyValue(env, args.name);
    if (!value) throw new KeyStoreError('GENESIS_KEY_NOT_SET', `"${row.label}" has no value yet; ask the user to save it on the key page (genesis_openKeyManager)`, 409);
    const file = path.resolve(settings.cwd ?? process.cwd(), args.file);
    const refusal = envFileRefusal(file);
    if (refusal) throw new KeyStoreError('GENESIS_ENV_FILE_REFUSED', refusal, 422);
    const { created, replaced } = writeEnvVariable(file, args.variable, value);
    return { written: true, key: args.name, file, variable: args.variable, created, replaced };
  },
};

/** Runs a key tool; answers `{ ok, body }` like an API call. Never throws. */
export async function runKeyTool(name, args, settings) {
  try {
    return { ok: true, httpStatus: null, body: await HANDLERS[name](args, settings) };
  } catch (err) {
    if (err instanceof KeyStoreError) return { ok: false, httpStatus: null, body: genesisError(err.code, err.message) };
    return { ok: false, httpStatus: null, body: genesisError('GENESIS_TOOL_FAILED', `${name} failed: ${err?.message ?? String(err)}`) };
  }
}
