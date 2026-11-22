#!/usr/bin/env node
// genesis-set: install the Genesis compiler skills for coding agents, on top of
// mind-set (the OpenAPPL skills). No runtime dependency besides mind-set, Node >= 18.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configCommand, offerApiKey } from '../lib/config-cli.mjs';
import { initProject } from '../lib/init.mjs';
import { chooseAgents, doctor, install, resolveContext, uninstall, update } from '../lib/install.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

const HELP = `genesis ${pkg.version}: Genesis compiler skills for coding agents (PRE-RELEASE; genesis-set is an alias)

Usage:
  genesis install [--claude] [--codex] [--force] [--no-mcp] [--no-key] [--dry-run]
  genesis init [<folder>] [--dry-run]
  genesis update [--claude] [--codex] [--force] [--no-mcp] [--dry-run]
  genesis uninstall [--dry-run]
  genesis doctor
  genesis config [show | set-key | unset-key | set-base <url> | unset-base]
  genesis board [<folder>] [--no-open]
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
init       prepares a project folder (default: the current one) so the agent
           works the OpenAPPL + Genesis way from its first session: a marked
           block in CLAUDE.md (Claude Code) and AGENTS.md (Codex) with the
           order of work and the key rules (your own content in those files
           is kept; a second run only refreshes the block), design/ and the
           env and secrets lines of .gitignore. It prints the API key status
           and a starter prompt. The one command that writes into a project.
update     install for this version (and every agent installed before), then
           delete older genesis-set corpus versions.
uninstall  removes only what install recorded in ~/.genesis-set/installed.json;
           mind-set stays.
doctor     both versions (genesis-set and mind-set) and whether they are
           compatible, the skills and the MCP server per agent, where the API
           key comes from (never its value) and the API base.
board      opens the project board of the genesis project in <folder>
           (default: the current one; "genesis init" makes a project): the
           design flow with each document's state and check, the documents,
           the interview, the blueprint and its validation, and the project's
           and your global keys. It runs on 127.0.0.1:${'4747'} (or the next free
           port) until it is idle for an hour or Ctrl+C; a board already
           running for the project is reused. The link it opens can change
           keys; the plain address (bookmark it) is read-only.
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
  init: ['dryRun'],
  update: ['claude', 'codex', 'force', 'noMcp', 'dryRun'],
  uninstall: ['dryRun'],
  doctor: [],
  config: [],
  keys: ['noOpen'],
  board: ['noOpen'],
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
  if (command === 'init') {
    if (positional.length > 2) {
      err('error: init takes one folder at most');
      return 2;
    }
    return initProject({ dir: positional[1] ?? process.cwd(), env: process.env, out, err, dryRun: flags.dryRun === true });
  }
  if (command === 'board') {
    if (positional.length > 2) {
      err('error: board takes one folder at most');
      return 2;
    }
    const { findProject } = await import('../mcp/project.mjs');
    const folder = path.resolve(positional[1] ?? process.cwd());
    const project = findProject(folder);
    if (!project) {
      err(`error: ${folder} is not a genesis project. Run "genesis init" there first (or "genesis keys" for your global keys).`);
      return 1;
    }
    const { ensureBoard, boardClosed, closeBoard } = await import('../mcp/board.mjs');
    const { openInBrowser } = await import('../mcp/key-tools.mjs');
    const board = await ensureBoard({ env: process.env, project });
    out(`Genesis board for "${project.name}": ${board.readUrl}`);
    if (flags.noOpen !== true && !openInBrowser(board.url)) out('Could not open a browser: open the link yourself.');
    if (board.reused && board.idleMinutes === null) {
      out(board.url === board.readUrl ? 'The board already runs in another process (read-only link).' : 'The board already runs in another process; opened it there.');
      return 0;
    }
    if (flags.noOpen === true) out(`To change keys, open: ${board.url}`);
    out(`It closes after ${board.idleMinutes} idle minutes, or press Ctrl+C.`);
    process.once('SIGINT', () => closeBoard());
    process.once('SIGTERM', () => closeBoard());
    const keepAlive = setInterval(() => {}, 1 << 30);
    await boardClosed();
    clearInterval(keepAlive);
    out('The board is closed.');
    return 0;
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
