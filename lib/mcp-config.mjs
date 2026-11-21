// Registers the genesis-set MCP server with the installed agents, at user scope
// (never in a project folder):
//   Claude Code  ~/.claude.json            mcpServers.genesis = { type: "stdio", command, args, env }
//   Codex        $CODEX_HOME/config.toml   a managed [mcp_servers.genesis] block (CODEX_HOME = ~/.codex)
// The server itself is copied to <data>/mcp/ so the registration survives an
// npm cache or a moved package. Only an entry genesis-set wrote is replaced or
// removed; a foreign `genesis` entry blocks the registration (Claude Code: unless
// --force, the old entry is backed up first).

import fs from 'node:fs';
import path from 'node:path';

export const MCP_SERVER_NAME = 'genesis';
// The exact text of this marker is how update / uninstall find the block in an
// existing config.toml: it keeps the old command names on purpose (#9355).
const TOML_BEGIN = '# >>> genesis-set: managed block, written by "genesis-set install"; "genesis-set uninstall" removes it';
const TOML_END = '# <<< genesis-set';

export function mcpServerDir(ctx) {
  return path.join(ctx.dataDir, 'mcp');
}

export function mcpServerFile(ctx) {
  return path.join(mcpServerDir(ctx), 'server.mjs');
}

export function claudeConfigFile(ctx) {
  return path.join(ctx.home, '.claude.json');
}

export function codexConfigFile(ctx) {
  const dir = ctx.env.CODEX_HOME ? path.resolve(ctx.env.CODEX_HOME) : path.join(ctx.home, '.codex');
  return path.join(dir, 'config.toml');
}

/** The command an agent runs: this Node, the copied server, and GENESIS_SET_HOME when it is not the default. */
export function serverLaunch(ctx) {
  const env = {};
  if (ctx.env.GENESIS_SET_HOME) env.GENESIS_SET_HOME = ctx.dataDir;
  return { command: ctx.nodePath ?? process.execPath, args: [mcpServerFile(ctx)], env };
}

/** Copies the package's mcp/ folder to <data>/mcp/ and stamps the version. */
export function copyServer(ctx) {
  const src = path.join(ctx.pkgRoot, 'mcp');
  const dest = mcpServerDir(ctx);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
  fs.writeFileSync(path.join(dest, 'version.json'), `${JSON.stringify({ package: 'genesis-set', version: ctx.version }, null, 2)}\n`);
  // An ES module folder outside any package.json: say so, so `node server.mjs` never guesses.
  fs.writeFileSync(path.join(dest, 'package.json'), '{ "type": "module", "private": true }\n');
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    mode = 0o600;
  }
  const tmp = `${file}.genesis-set.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

// ── Claude Code ─────────────────────────────────────────────────────

function readClaudeJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { data: {} };
    return { error: `cannot read ${file}: ${e.message}` };
  }
  if (!text.trim()) return { data: {} };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: `${file} is not a JSON object` };
    return { data };
  } catch {
    return { error: `${file} is not valid JSON; fix it or register the server by hand ("claude mcp add")` };
  }
}

function isOurClaudeEntry(entry, ctx) {
  return Boolean(entry && Array.isArray(entry.args) && entry.args[0] === mcpServerFile(ctx));
}

/** { status: written | blocked | failed, message } */
export function registerClaude(ctx, { force = false } = {}) {
  const file = claudeConfigFile(ctx);
  const { data, error } = readClaudeJson(file);
  if (error) return { status: 'failed', message: error };
  const existing = data.mcpServers?.[MCP_SERVER_NAME];
  if (existing && !isOurClaudeEntry(existing, ctx)) {
    if (!force) {
      return {
        status: 'blocked',
        message: `${file} already has an MCP server "${MCP_SERVER_NAME}" that genesis-set did not write (use --force to replace it; the old entry is backed up)`,
      };
    }
    if (!ctx.dryRun) {
      const backup = path.join(ctx.dataDir, 'backup', `claude-mcp-${MCP_SERVER_NAME}-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, `${JSON.stringify(existing, null, 2)}\n`);
    }
  }
  const { command, args, env } = serverLaunch(ctx);
  if (!ctx.dryRun) {
    data.mcpServers = { ...(data.mcpServers ?? {}), [MCP_SERVER_NAME]: { type: 'stdio', command, args, env } };
    writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return { status: 'written', message: `register MCP server "${MCP_SERVER_NAME}" for Claude Code in ${file}` };
}

export function unregisterClaude(ctx) {
  const file = claudeConfigFile(ctx);
  const { data, error } = readClaudeJson(file);
  if (error) return { status: 'failed', message: error };
  const existing = data.mcpServers?.[MCP_SERVER_NAME];
  if (!existing) return { status: 'absent', message: `no MCP server "${MCP_SERVER_NAME}" in ${file}` };
  if (!isOurClaudeEntry(existing, ctx)) return { status: 'kept', message: `keep the MCP server "${MCP_SERVER_NAME}" in ${file}: genesis-set did not write it` };
  if (!ctx.dryRun) {
    delete data.mcpServers[MCP_SERVER_NAME];
    writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  return { status: 'removed', message: `remove MCP server "${MCP_SERVER_NAME}" from ${file}` };
}

export function claudeRegistration(ctx) {
  const { data } = readClaudeJson(claudeConfigFile(ctx));
  const entry = data?.mcpServers?.[MCP_SERVER_NAME];
  if (!entry) return 'not registered';
  return isOurClaudeEntry(entry, ctx) ? 'registered' : 'a foreign "genesis" entry';
}

// ── Codex ───────────────────────────────────────────────────────────

const tomlString = (s) => JSON.stringify(String(s));

function codexBlock(ctx) {
  const { command, args, env } = serverLaunch(ctx);
  const lines = [TOML_BEGIN, `[mcp_servers.${MCP_SERVER_NAME}]`, `command = ${tomlString(command)}`, `args = [${args.map(tomlString).join(', ')}]`];
  const keys = Object.keys(env);
  if (keys.length) {
    lines.push(`[mcp_servers.${MCP_SERVER_NAME}.env]`);
    for (const k of keys) lines.push(`${k} = ${tomlString(env[k])}`);
  }
  lines.push(TOML_END, '');
  return lines.join('\n');
}

/** The text with our managed block removed, and whether there was one. */
function withoutManagedBlock(text) {
  const start = text.indexOf(TOML_BEGIN);
  if (start < 0) return { text, had: false };
  const endAt = text.indexOf(TOML_END, start);
  if (endAt < 0) return { text, had: false, broken: true };
  let end = endAt + TOML_END.length;
  const nl = text.indexOf('\n', end);
  end = nl < 0 ? text.length : nl + 1;
  return { text: text.slice(0, start) + text.slice(end), had: true };
}

const FOREIGN_TABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:${MCP_SERVER_NAME}|"${MCP_SERVER_NAME}")\\s*\\]`, 'm');

export function registerCodex(ctx) {
  const file = codexConfigFile(ctx);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') return { status: 'failed', message: `cannot read ${file}: ${e.message}` };
  }
  const stripped = withoutManagedBlock(text);
  if (stripped.broken) return { status: 'failed', message: `${file} has a genesis-set block without its end line; fix it by hand` };
  if (FOREIGN_TABLE.test(stripped.text)) {
    return {
      status: 'blocked',
      message: `${file} already defines [mcp_servers.${MCP_SERVER_NAME}] outside the genesis-set block; remove or rename it, then run "genesis install" again`,
    };
  }
  if (!ctx.dryRun) {
    const base = stripped.text.length && !stripped.text.endsWith('\n') ? `${stripped.text}\n` : stripped.text;
    writeAtomic(file, `${base}${base.trim() ? '\n' : ''}${codexBlock(ctx)}`);
  }
  return { status: 'written', message: `register MCP server "${MCP_SERVER_NAME}" for Codex in ${file}` };
}

export function unregisterCodex(ctx) {
  const file = codexConfigFile(ctx);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { status: 'absent', message: `no ${file}` };
  }
  const stripped = withoutManagedBlock(text);
  if (!stripped.had) return { status: 'absent', message: `no genesis-set block in ${file}` };
  if (!ctx.dryRun) writeAtomic(file, stripped.text.replace(/\n{3,}$/, '\n\n'));
  return { status: 'removed', message: `remove the genesis-set MCP block from ${file}` };
}

export function codexRegistration(ctx) {
  let text;
  try {
    text = fs.readFileSync(codexConfigFile(ctx), 'utf8');
  } catch {
    return 'not registered';
  }
  if (withoutManagedBlock(text).had) return 'registered';
  return FOREIGN_TABLE.test(text) ? 'a foreign "genesis" entry' : 'not registered';
}

export const REGISTER = { claude: registerClaude, codex: registerCodex };
export const UNREGISTER = { claude: unregisterClaude, codex: unregisterCodex };
export const REGISTRATION = { claude: claudeRegistration, codex: codexRegistration };
