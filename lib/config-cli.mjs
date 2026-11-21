// `genesis config`: the Genesis API key and API base in the genesis-set
// config file (<data>/config.json, mode 0600; <data> = GENESIS_SET_HOME or
// ~/.genesis-set). The key is read from stdin, never from the command line (it
// would land in the shell history), and never printed back.

import {
  API_BASE_ENV,
  API_KEY_ENV,
  DEFAULT_API_BASE,
  configPathOf,
  normalizeApiBase,
  portalKeysUrl,
  readConfigFile,
  resolveSettings,
  writeConfigFile,
} from '../mcp/config.mjs';

/** One line from stdin; on a terminal, without echo. */
async function readSecretLine(prompt, errOut) {
  const stdin = process.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    errOut(prompt);
    return new Promise((resolve) => {
      let value = '';
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
      stdin.resume();
      const onData = (chunk) => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n' || ch === '\u0004') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            process.stderr.write('\n');
            resolve(value);
            return;
          }
          if (ch === '\u0003') {
            stdin.setRawMode(false);
            process.stderr.write('\n');
            resolve(null);
            return;
          }
          if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
          else value += ch;
        }
      };
      stdin.on('data', onData);
    });
  }
  let text = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) text += chunk;
  return text.split(/\r?\n/)[0] ?? '';
}

/** Why a key cannot be stored, or null when it can. */
function keyProblem(key) {
  if (!key) return 'no key read';
  if (/\s/.test(key)) return 'the key must not contain whitespace';
  return null;
}

/**
 * The key step at the end of `genesis install`. A set key is only reported (never its
 * value). Without one: on a terminal the user is pointed at the portal and the key is read
 * hidden (Enter skips); without a terminal (an agent runs the install) the link and the
 * command are printed and nothing waits for input. Never fails the install.
 */
export async function offerApiKey({
  env = process.env,
  out,
  err,
  dryRun = false,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  readSecret = readSecretLine,
}) {
  const s = resolveSettings(env);
  const url = portalKeysUrl(s.apiBase);
  if (s.apiKey) {
    out(`Genesis API key: set (from ${s.keySource}); its value is never printed.`);
    return;
  }
  const later = `"genesis config set-key" in a terminal, or set ${API_KEY_ENV} in the environment the agent starts from`;
  if (dryRun) {
    out(`dry run: no API key asked. Create one at ${url}, then ${later}.`);
    return;
  }
  if (!interactive) {
    out(`No Genesis API key yet: the user creates one at ${url} (it is shown once), then runs ${later}.`);
    return;
  }
  const file = configPathOf(env);
  const current = readConfigFile(file);
  if (current.__error) {
    err(`No API key stored: ${current.__error}. Fix or delete it, then run "genesis config set-key".`);
    return;
  }
  out(`No Genesis API key yet. Create one at ${url} (it is shown once).`);
  const key = ((await readSecret('Paste the key (input hidden), or press Enter to skip: ', (l) => process.stderr.write(l))) ?? '').trim();
  if (!key) {
    out(`Skipped. Later: ${later} (key from ${url}).`);
    return;
  }
  const problem = keyProblem(key);
  if (problem) {
    err(`No API key stored: ${problem}. Run "genesis config set-key" to try again.`);
    return;
  }
  writeConfigFile(file, Object.fromEntries(Object.entries({ ...current, apiKey: key }).filter(([k, v]) => k !== '__error' && v !== undefined)));
  out(`API key stored in ${file} (readable only by you). Manage it and your other keys any time with "genesis keys".`);
}

function show(env, out) {
  const s = resolveSettings(env);
  out(`config file: ${s.configFile}`);
  out(`API key: ${s.apiKey ? `set (from ${s.keySource}); the value is never printed` : `not set (${API_KEY_ENV} or "genesis config set-key"; create one at ${portalKeysUrl(s.apiBase)})`}`);
  out(`API base: ${s.apiBase} (${s.baseSource})`);
  for (const p of s.problems) out(`problem: ${p}`);
  return s.problems.length ? 1 : 0;
}

export async function configCommand(args, { env = process.env, out, err }) {
  const [sub = 'show', value] = args;
  const file = configPathOf(env);
  const current = readConfigFile(file);
  if (current.__error && sub !== 'show') {
    err(`error: ${current.__error}; fix or delete it first`);
    return 1;
  }
  const save = (next) => writeConfigFile(file, Object.fromEntries(Object.entries(next).filter(([k, v]) => k !== '__error' && v !== undefined)));
  switch (sub) {
    case 'show':
      return show(env, out);
    case 'set-key': {
      const key = ((await readSecretLine('Genesis API key (input hidden), then Enter: ', (l) => process.stderr.write(l))) ?? '').trim();
      const problem = keyProblem(key);
      if (problem) {
        err(`error: ${problem === 'no key read' ? 'no key read from stdin' : problem}; nothing changed`);
        return 1;
      }
      save({ ...current, apiKey: key });
      out(`API key stored in ${file} (readable only by you).${env[API_KEY_ENV] ? ` Note: ${API_KEY_ENV} is set and wins over the file.` : ''}`);
      return 0;
    }
    case 'unset-key':
      save({ ...current, apiKey: undefined });
      out(`API key removed from ${file}`);
      return 0;
    case 'set-base': {
      if (!value) {
        err('error: set-base needs a URL (or "default")');
        return 2;
      }
      if (value === 'default') {
        save({ ...current, apiBase: undefined });
        out(`API base reset to ${DEFAULT_API_BASE}`);
        return 0;
      }
      let base;
      try {
        base = normalizeApiBase(value);
      } catch (e) {
        err(`error: ${e.message}`);
        return 2;
      }
      save({ ...current, apiBase: base });
      out(`API base set to ${base} in ${file}${env[API_BASE_ENV] ? ` (${API_BASE_ENV} is set and wins over the file)` : ''}`);
      return 0;
    }
    case 'unset-base':
      save({ ...current, apiBase: undefined });
      out(`API base reset to ${DEFAULT_API_BASE}`);
      return 0;
    default:
      err(`error: unknown config command "${sub}" (show, set-key, unset-key, set-base <url>, unset-base)`);
      return 2;
  }
}
