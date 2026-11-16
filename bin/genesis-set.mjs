#!/usr/bin/env node
// genesis-set: install the Genesis compiler skills for coding agents, on top of
// mind-set (the OpenAPPL skills). No runtime dependency besides mind-set, Node >= 18.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseAgents, doctor, install, resolveContext, uninstall, update } from '../lib/install.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

const HELP = `genesis-set ${pkg.version}: Genesis compiler skills for coding agents (PRE-RELEASE)

Usage:
  genesis-set install [--claude] [--codex] [--force] [--dry-run]
  genesis-set update [--claude] [--codex] [--force] [--dry-run]
  genesis-set uninstall [--dry-run]
  genesis-set doctor
  genesis-set --version | --help

install    makes sure mind-set ${pkg.dependencies?.['@mindbricks/mind-set'] ?? ''} is installed (installs the
           mind-set that comes with this package when it is missing or older),
           copies the genesis-set corpus to ~/.genesis-set/<version>/ (linked as
           ~/.genesis-set/current) and writes the genesis-* skills to every
           detected agent: Claude Code (~/.claude/skills) and Codex
           (~/.agents/skills). --claude / --codex pick the agents. A mind-set
           skill folder is never replaced; another foreign folder only with
           --force (backed up first). Nothing is written into a project folder.
update     install for this version (and every agent installed before), then
           delete older genesis-set corpus versions.
uninstall  removes only what install recorded in ~/.genesis-set/installed.json;
           mind-set stays.
doctor     both versions (genesis-set and mind-set) and whether they are
           compatible, the skills per agent, and whether GENESIS_API_KEY is set.

The Genesis Compiler API is not reachable yet: this release teaches the
compiler's output and the API surface ahead of its opening.

Environment: HOME is where the agents live; GENESIS_SET_HOME moves
~/.genesis-set; MIND_SET_HOME moves ~/.mind-set; GENESIS_API_KEY holds the
Compiler API key (environment only, never a file in a project).`;

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
  install: ['claude', 'codex', 'force', 'dryRun'],
  update: ['claude', 'codex', 'force', 'dryRun'],
  uninstall: ['dryRun'],
  doctor: [],
};

function main(argv) {
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
    err(`error: unknown command "${command}" (see genesis-set --help)`);
    return 2;
  }
  const unknown = Object.keys(flags).filter((f) => !KNOWN_FLAGS[command].includes(f));
  if (unknown.length) {
    err(`error: unknown option for ${command}: ${unknown.map((f) => `--${f}`).join(', ')}`);
    return 2;
  }
  const ctx = resolveContext({ pkgRoot, pkg, out, dryRun: flags.dryRun === true });
  switch (command) {
    case 'install':
      return install(ctx, chooseAgents(ctx, flags), { force: flags.force === true });
    case 'update':
      return update(ctx, chooseAgents(ctx, flags, { includeManifest: true }), { force: flags.force === true });
    case 'uninstall':
      return uninstall(ctx);
    case 'doctor':
      return doctor(ctx);
    default:
      return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
