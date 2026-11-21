#!/usr/bin/env node
// genesis-set: install the Genesis compiler skills for coding agents, on top of
// mind-set (the OpenAPPL skills). No runtime dependency besides mind-set, Node >= 18.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configCommand, offerApiKey } from '../lib/config-cli.mjs';
import { chooseAgents, doctor, install, resolveContext, uninstall, update } from '../lib/install.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

const HELP = `genesis ${pkg.version}: Genesis compiler skills for coding agents (PRE-RELEASE; genesis-set is an alias)

Usage:
  genesis install [--claude] [--codex] [--force] [--no-mcp] [--no-key] [--dry-run]
  genesis update [--claude] [--codex] [--force] [--no-mcp] [--dry-run]
  genesis uninstall [--dry-run]
  genesis doctor
  genesis config [show | set-key | unset-key | set-base <url> | unset-base]
  genesis keys [--no-open]
  genesis mcp
  genesis --version | --help

install    makes sure mind-set ${pkg.dependencies?.['@mindbricks/mind-set'] ?? ''} is installed (installs the
           mind-set that comes with this package when it is missing or older),
           copies the genesis-set corpus to ~/.genesis-set/<version>/ (linked as
           ~/.genesis-set/current) and writes the genesis-* skills to every
           detected agent: Claude Code (~/.claude/skills) and Codex
           (~/.agents/skills). --claude / --codex pick the agents. A mind-set
           skill folder is never replaced; another foreign folder only with
           --force (backed up first). It also copies the genesis-set MCP server
           (the genesis_* tools) to ~/.genesis-set/mcp/ and registers it as the
           MCP server "genesis" at user scope: ~/.claude.json for Claude Code,
           ~/.codex/config.toml for Codex (--no-mcp skips that). Last, the
           API key: with none set, it names the portal page that creates one
           and, on a terminal, reads it hidden (Enter skips; --no-key skips
           the step). Nothing is written into a project folder.
update     install for this version (and every agent installed before), then
           delete older genesis-set corpus versions.
uninstall  removes only what install recorded in ~/.genesis-set/installed.json;
           mind-set stays.
doctor     both versions (genesis-set and mind-set) and whether they are
           compatible, the skills and the MCP server per agent, where the API
           key comes from (never its value) and the API base.
keys       opens the local key page in your browser (the page the agent
           links to): add, change, clear or delete the keys your agent uses.
           The link is new every time; the page closes after 15 idle minutes
           or on Ctrl+C. --no-open only prints the link.
config     the Genesis API key and API base in ~/.genesis-set/config.json
           (mode 0600). set-key reads the key from stdin, never from the
           command line. GENESIS_API_KEY / GENESIS_API_BASE win over the file.
mcp        runs the MCP server on stdio from this package (what the agents
           start; for a manual registration).

The Genesis Compiler API builds are dry runs for now: the code is generated
and measured, nothing is pushed yet.

Environment: HOME is where the agents live; GENESIS_SET_HOME moves
~/.genesis-set; MIND_SET_HOME moves ~/.mind-set; CODEX_HOME moves ~/.codex;
GENESIS_API_KEY holds the Compiler API key and GENESIS_API_BASE the API base
(default https://api.genesiscompiler.com). Never put the key in a project.`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const name = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      flags[name] = true;
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else positional.push(a);
  }
  return { flags, positional };
}

const KNOWN_FLAGS = {
  install: ['claude', 'codex', 'force', 'noMcp', 'noKey', 'dryRun'],
  update: ['claude', 'codex', 'force', 'noMcp', 'dryRun'],
  uninstall: ['dryRun'],
  doctor: [],
  config: [],
  keys: ['noOpen'],
  mcp: [],
};

async function main(argv) {
  const { flags, positional } = parseArgs(argv);
  if (flags.version) {
    out(pkg.version);
    return 0;
  }
  const command = positional[0];
  if (flags.help || !command || command === 'help') {
    out(HELP);
    return command || flags.help ? 0 : 2;
  }
  if (!KNOWN_FLAGS[command]) {
    err(`error: unknown command "${command}" (see genesis --help)`);
    return 2;
  }
  const unknown = Object.keys(flags).filter((f) => !KNOWN_FLAGS[command].includes(f));
  if (unknown.length) {
    err(`error: unknown option for ${command}: ${unknown.map((f) => `--${f}`).join(', ')}`);
    return 2;
  }
  if (command === 'keys') {
    const { ensureKeyPage, keyPageClosed, closeKeyPage } = await import('../mcp/key-page.mjs');
    const { openInBrowser } = await import('../mcp/key-tools.mjs');
    const link = await ensureKeyPage({ env: process.env });
    out(`Genesis keys: ${link.url}`);
    out(`This link works on this machine only. The page closes after ${link.expiresAfterIdleMinutes} idle minutes, or press Ctrl+C.`);
    if (flags.noOpen !== true && !openInBrowser(link.url)) out('Could not open a browser: open the link yourself.');
    process.once('SIGINT', () => closeKeyPage());
    process.once('SIGTERM', () => closeKeyPage());
    const keepAlive = setInterval(() => {}, 1 << 30);
    await keyPageClosed();
    clearInterval(keepAlive);
    out('The key page is closed.');
    return 0;
  }
  if (command === 'mcp') {
    const { serve } = await import('../mcp/server.mjs');
    await serve();
    return 0;
  }
  const ctx = resolveContext({ pkgRoot, pkg, out, dryRun: flags.dryRun === true });
  const opts = { force: flags.force === true, mcp: flags.noMcp !== true };
  switch (command) {
    case 'install': {
      const code = install(ctx, chooseAgents(ctx, flags), opts);
      if (flags.noKey !== true) await offerApiKey({ env: process.env, out, err, dryRun: ctx.dryRun });
      return code;
    }
    case 'update':
      return update(ctx, chooseAgents(ctx, flags, { includeManifest: true }), opts);
    case 'config':
      return configCommand(positional.slice(1), { env: process.env, out, err });
    case 'uninstall':
      return uninstall(ctx);
    case 'doctor':
      return doctor(ctx);
    default:
      return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
