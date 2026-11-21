// install / update / uninstall / doctor for the genesis-set package.
//
// genesis-set sits on mind-set (the OpenAPPL layer): it adds the Genesis
// compiler skills and never copies or replaces a mind-set skill. Layout:
//   <data>/<version>/          the genesis-set corpus of that version
//   <data>/current             link to the corpus the skills point at
//   <data>/installed.json      the manifest: every path install wrote
//   <claude>/skills/genesis-*  Claude Code skills (<claude> = ~/.claude)
//   <agents>/skills/genesis-*  Codex skills (<agents> = ~/.agents)
//   <data>/mcp/                the genesis-set MCP server (the genesis_* tools),
//                              registered with each agent at user scope
//                              (~/.claude.json, ~/.codex/config.toml); see mcp-config.mjs
//   <data>/config.json         the Genesis API key and API base, when the user
//                              stores them with `genesis-set config` (never a project file)
// <data> is ~/.genesis-set unless GENESIS_SET_HOME names another folder.
// mind-set keeps its own data folder (~/.mind-set, or MIND_SET_HOME) and is
// installed by its own CLI: when it is missing, or older than the range in
// package.json `dependencies["@mindbricks/mind-set"]`, install runs the mind-set package
// that came with genesis-set. Nothing is written into a project folder.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { REGISTER, REGISTRATION, UNREGISTER, copyServer, mcpServerDir, mcpServerFile } from './mcp-config.mjs';
import { compareVersions, satisfies } from './semver.mjs';
import { portalKeysUrl, resolveSettings } from '../mcp/config.mjs';

export const PACKAGE_NAME = 'genesis-set';
export const MARKER = '.genesis-set.json';
export const MIND_SET_MARKER = '.mind-set.json';
export const MANIFEST = 'installed.json';
export const CORPUS_PLACEHOLDER = '{{CORPUS}}';
export const MIND_SET_PLACEHOLDER = '{{MIND_SET}}';
export const SKILL_PREFIX = 'genesis-';
/** The npm name of mind-set (the command and the installed manifest say `mind-set`). */
export const MIND_SET_NPM = '@mindbricks/mind-set';
/** The environment variable that holds the Genesis Compiler API key (never a file in the project). */
export const API_KEY_ENV = 'GENESIS_API_KEY';
const VERSION_DIR = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/** Resolves every location from the environment (HOME, GENESIS_SET_HOME, MIND_SET_HOME, PATH). */
export function resolveContext({ env = process.env, pkgRoot, pkg, out, dryRun = false }) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const dataDir = env.GENESIS_SET_HOME ? path.resolve(env.GENESIS_SET_HOME) : path.join(home, '.genesis-set');
  const mindSetDir = env.MIND_SET_HOME ? path.resolve(env.MIND_SET_HOME) : path.join(home, '.mind-set');
  return {
    env,
    home,
    dataDir,
    mindSetDir,
    pathEnv: env.PATH || env.Path || '',
    pkgRoot,
    nodePath: env.GENESIS_SET_NODE ? path.resolve(env.GENESIS_SET_NODE) : process.execPath,
    version: pkg.version,
    mindSetRange: pkg.dependencies?.[MIND_SET_NPM] ?? null,
    dryRun,
    out,
    agents: {
      claude: {
        name: 'claude',
        label: 'Claude Code',
        configDir: path.join(home, '.claude'),
        skillsDir: path.join(home, '.claude', 'skills'),
        flag: '--claude',
      },
      codex: {
        name: 'codex',
        label: 'Codex',
        configDir: path.join(home, '.codex'),
        skillsDir: path.join(home, '.agents', 'skills'),
        flag: '--codex',
      },
    },
  };
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function remove(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function onPath(ctx, binary) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of ctx.pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (fs.statSync(path.join(dir, binary + ext)).isFile()) return true;
      } catch {
        // not in this PATH entry
      }
    }
  }
  return false;
}

/** Which agents are on this machine, and why we think so. */
export function detectAgents(ctx) {
  const found = {};
  found.claude = exists(ctx.agents.claude.configDir) ? `found ${ctx.agents.claude.configDir}` : null;
  if (exists(ctx.agents.codex.configDir)) found.codex = `found ${ctx.agents.codex.configDir}`;
  else if (onPath(ctx, 'codex')) found.codex = 'found codex on PATH';
  else found.codex = null;
  return found;
}

/**
 * Which agents a command writes to. Explicit flags win (and force an agent
 * that is not detected); with no flag, every detected agent; for `update`,
 * also every agent the previous install wrote to.
 */
export function chooseAgents(ctx, flags, { includeManifest = false } = {}) {
  const chosen = [];
  if (flags.claude) chosen.push('claude');
  if (flags.codex) chosen.push('codex');
  if (chosen.length) return chosen;
  const detected = detectAgents(ctx);
  const set = new Set(Object.keys(detected).filter((a) => detected[a]));
  if (includeManifest) {
    for (const a of Object.keys(readManifest(ctx)?.agents ?? {})) if (ctx.agents[a]) set.add(a);
  }
  return ['claude', 'codex'].filter((a) => set.has(a));
}

export function readManifest(ctx) {
  return readJson(path.join(ctx.dataDir, MANIFEST));
}

function readMarker(dir, marker = MARKER, pkg = PACKAGE_NAME) {
  const m = readJson(path.join(dir, marker));
  return m && m.package === pkg ? m : null;
}

function packageSkills(ctx) {
  const dir = path.join(ctx.pkgRoot, 'skills');
  let names = [];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && exists(path.join(dir, d.name, 'SKILL.md')))
      .map((d) => d.name)
      .sort();
  } catch {
    // no skills folder
  }
  return { dir, names };
}

function copyDir(src, dest, transform) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, transform);
    else if (entry.isFile()) {
      if (transform && entry.name.endsWith('.md')) fs.writeFileSync(d, transform(fs.readFileSync(s, 'utf8')));
      else fs.copyFileSync(s, d);
    }
  }
}

/** Points `<data>/current` at the corpus: a symlink (a junction on Windows), else a copy. */
function linkCurrent(ctx, corpusDir) {
  const current = path.join(ctx.dataDir, 'current');
  remove(current);
  try {
    fs.symlinkSync(corpusDir, current, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    copyDir(corpusDir, current);
  }
  return current;
}

// ── mind-set ────────────────────────────────────────────────────────

/** The installed mind-set: its manifest, or null when it is not installed. */
export function installedMindSet(ctx) {
  const m = readJson(path.join(ctx.mindSetDir, MANIFEST));
  return m && m.package === 'mind-set' ? m : null;
}

/** The mind-set corpus the genesis-set skills point at (stable across mind-set updates). */
export function mindSetCorpus(ctx) {
  return path.join(ctx.mindSetDir, 'current');
}

/**
 * The mind-set package that came with genesis-set (its npm dependency), or the
 * folder GENESIS_SET_MIND_SET_PACKAGE names. Null when neither is there.
 */
export function bundledMindSet(ctx) {
  const candidates = [];
  if (ctx.env.GENESIS_SET_MIND_SET_PACKAGE) candidates.push(path.resolve(ctx.env.GENESIS_SET_MIND_SET_PACKAGE));
  try {
    const req = createRequire(path.join(ctx.pkgRoot, 'package.json'));
    candidates.push(path.dirname(req.resolve(`${MIND_SET_NPM}/package.json`)));
  } catch {
    // not resolvable from this package
  }
  for (const dir of candidates) {
    const pkg = readJson(path.join(dir, 'package.json'));
    const bin = path.join(dir, 'bin', 'mind-set.mjs');
    if ((pkg?.name === MIND_SET_NPM || pkg?.name === 'mind-set') && exists(bin)) return { dir, version: String(pkg.version), bin };
  }
  return null;
}

/** Where mind-set stands against the range: ok, missing, old (an update fixes it) or incompatible. */
export function mindSetState(ctx) {
  const installed = installedMindSet(ctx);
  const version = installed?.version ?? null;
  if (!version) return { state: 'missing', version: null };
  const ok = ctx.mindSetRange ? satisfies(version, ctx.mindSetRange) : true;
  if (ok) return { state: 'ok', version };
  const bundled = bundledMindSet(ctx);
  if (bundled && satisfies(bundled.version, ctx.mindSetRange) && compareVersions(version, bundled.version) < 0) {
    return { state: 'old', version };
  }
  return { state: 'incompatible', version };
}

function runMindSet(ctx, bundled, command, agentNames) {
  const args = [bundled.bin, command, ...agentNames.map((a) => ctx.agents[a].flag)];
  if (ctx.dryRun) args.push('--dry-run');
  const res = spawnSync(process.execPath, args, { env: ctx.env, encoding: 'utf8' });
  for (const line of `${res.stdout ?? ''}${res.stderr ?? ''}`.split('\n')) if (line) ctx.out(`  mind-set: ${line}`);
  return res.status ?? 1;
}

/**
 * Makes sure a compatible mind-set is installed for `agentNames`: installs the
 * bundled mind-set when none is installed, updates an older one, and leaves a
 * compatible one alone. Returns 0, or 1 when mind-set cannot be made compatible.
 */
export function ensureMindSet(ctx, agentNames) {
  const st = mindSetState(ctx);
  const range = ctx.mindSetRange ?? 'any';
  if (st.state === 'ok') {
    // A compatible mind-set; make sure every chosen agent has its skills.
    const have = installedMindSet(ctx)?.agents ?? {};
    const missing = agentNames.filter((a) => !have[a]);
    if (!missing.length) {
      ctx.out(`mind-set ${st.version} is installed (genesis-set needs ${range})`);
      return 0;
    }
    const bundled = bundledMindSet(ctx);
    if (!bundled) {
      ctx.out(`mind-set ${st.version} has no skills for ${missing.map((a) => ctx.agents[a].label).join(', ')}; run "mind-set install"`);
      return 1;
    }
    ctx.out(`mind-set ${st.version}: adding its skills for ${missing.map((a) => ctx.agents[a].label).join(', ')}`);
    return runMindSet(ctx, bundled, 'install', missing);
  }
  if (st.state === 'incompatible') {
    ctx.out(
      `error: mind-set ${st.version} is installed but genesis-set ${ctx.version} needs ${range}; ` +
        `install a genesis-set release made for it, or a mind-set in that range ("npm install -g ${MIND_SET_NPM}@<version>", then "mind-set install")`,
    );
    return 1;
  }
  const bundled = bundledMindSet(ctx);
  if (!bundled) {
    ctx.out(
      `error: mind-set is ${st.state === 'missing' ? 'not installed' : `${st.version}, older than ${range}`} ` +
        `and the mind-set package that comes with genesis-set was not found; run "npm install -g ${MIND_SET_NPM}" and "mind-set install" first`,
    );
    return 1;
  }
  if (!satisfies(bundled.version, ctx.mindSetRange ?? '*')) {
    ctx.out(`error: the bundled mind-set ${bundled.version} is outside ${range}; reinstall genesis-set`);
    return 1;
  }
  ctx.out(
    st.state === 'missing'
      ? `mind-set is not installed: installing mind-set ${bundled.version} (genesis-set needs ${range})`
      : `mind-set ${st.version} is older than ${range}: updating to ${bundled.version}`,
  );
  return runMindSet(ctx, bundled, st.state === 'missing' ? 'install' : 'update', agentNames);
}

// ── install / update / uninstall / doctor ────────────────────────────

/**
 * Makes mind-set compatible, copies the corpus and writes the genesis-set
 * skills for `agentNames`. Exit code 0 when everything chosen was written, 1
 * when mind-set could not be made compatible, a foreign or mind-set folder
 * blocked a skill, or the package is incomplete.
 */
export function install(ctx, agentNames, { force = false, skipMindSet = false, mcp = true } = {}) {
  const say = ctx.out;
  const act = (msg) => say(`${ctx.dryRun ? 'would ' : ''}${msg}`);
  const srcCorpus = path.join(ctx.pkgRoot, 'corpus');
  const skills = packageSkills(ctx);
  if (!exists(srcCorpus)) {
    say(`error: this package has no corpus/ folder (${srcCorpus})`);
    return 1;
  }
  if (skills.names.length === 0) {
    say(`error: this package has no skills under ${skills.dir}`);
    return 1;
  }
  const unprefixed = skills.names.filter((s) => !s.startsWith(SKILL_PREFIX));
  if (unprefixed.length) {
    say(`error: skill names must start with "${SKILL_PREFIX}": ${unprefixed.join(', ')}`);
    return 1;
  }
  if (agentNames.length === 0) {
    say(
      'error: no supported agent found (looked for ~/.claude, ~/.codex and codex on PATH).\n' +
        'Re-run with --claude and/or --codex to install for an agent anyway.',
    );
    return 1;
  }
  if (!skipMindSet) {
    const code = ensureMindSet(ctx, agentNames);
    if (code !== 0) return code;
  }

  const previous = readManifest(ctx);
  const corpusDir = path.join(ctx.dataDir, ctx.version);
  act(`copy corpus ${srcCorpus} -> ${corpusDir}`);
  if (!ctx.dryRun) {
    remove(corpusDir);
    copyDir(srcCorpus, corpusDir);
  }
  const current = path.join(ctx.dataDir, 'current');
  act(`link ${current} -> ${corpusDir}`);
  if (!ctx.dryRun) linkCurrent(ctx, corpusDir);

  const mindSet = mindSetCorpus(ctx);
  const fill = (text) => text.split(CORPUS_PLACEHOLDER).join(corpusDir).split(MIND_SET_PLACEHOLDER).join(mindSet);
  const agents = { ...(previous?.agents ?? {}) };
  let blocked = 0;
  const stamp = new Date().toISOString();
  for (const name of agentNames) {
    const agent = ctx.agents[name];
    const written = [];
    for (const skill of skills.names) {
      const dest = path.join(agent.skillsDir, skill);
      if (readMarker(dest, MIND_SET_MARKER, 'mind-set')) {
        // never, not even with --force: mind-set owns that folder
        say(`skip ${agent.label} skill ${skill}: ${dest} belongs to mind-set and is never replaced by genesis-set`);
        blocked++;
        continue;
      }
      const ours = readMarker(dest);
      if (exists(dest) && !ours) {
        if (!force) {
          say(
            `skip ${agent.label} skill ${skill}: ${dest} exists and was not written by genesis-set ` +
              '(use --force to replace it; the old folder is kept as a backup)',
          );
          blocked++;
          continue;
        }
        const backup = path.join(ctx.dataDir, 'backup', `${name}-${skill}-${stamp.replace(/[:.]/g, '-')}`);
        act(`back up foreign ${dest} -> ${backup}`);
        if (!ctx.dryRun) {
          fs.mkdirSync(path.dirname(backup), { recursive: true });
          fs.cpSync(dest, backup, { recursive: true });
        }
      }
      act(`write ${agent.label} skill ${skill} -> ${dest}`);
      if (!ctx.dryRun) {
        remove(dest);
        copyDir(path.join(skills.dir, skill), dest, fill);
        fs.writeFileSync(
          path.join(dest, MARKER),
          `${JSON.stringify({ package: PACKAGE_NAME, version: ctx.version, corpus: corpusDir, mindSet }, null, 2)}\n`,
        );
      }
      written.push(skill);
    }
    for (const old of previous?.agents?.[name]?.skills ?? []) {
      if (skills.names.includes(old)) continue;
      const dest = path.join(agent.skillsDir, old);
      if (!readMarker(dest)) continue;
      act(`remove retired ${agent.label} skill ${old} (${dest})`);
      if (!ctx.dryRun) remove(dest);
    }
    agents[name] = { skillsDir: agent.skillsDir, corpus: corpusDir, version: ctx.version, skills: written };
  }

  // The MCP server: one copy under <data>/mcp/, registered with each chosen agent.
  const mcpAgents = { ...(previous?.mcp?.agents ?? {}) };
  let mcpRegistered = 0;
  if (mcp) {
    if (!exists(path.join(ctx.pkgRoot, 'mcp', 'server.mjs'))) {
      say(`error: this package has no mcp/server.mjs`);
      return 1;
    }
    act(`copy MCP server ${path.join(ctx.pkgRoot, 'mcp')} -> ${mcpServerDir(ctx)}`);
    if (!ctx.dryRun) copyServer(ctx);
    for (const name of agentNames) {
      const r = REGISTER[name](ctx, { force });
      if (r.status === 'written') {
        act(r.message);
        mcpAgents[name] = { registered: true };
        mcpRegistered++;
      } else {
        say(`skip ${ctx.agents[name].label} MCP server: ${r.message}`);
        blocked++;
      }
    }
  }

  const manifest = {
    package: PACKAGE_NAME,
    version: ctx.version,
    mindSetRange: ctx.mindSetRange,
    installedAt: stamp,
    dataDir: ctx.dataDir,
    corpus: corpusDir,
    current,
    mindSetCorpus: mindSet,
    corpora: [...new Set([...(previous?.corpora ?? []), corpusDir])],
    agents,
    mcp: mcp || previous?.mcp ? { server: mcpServerFile(ctx), agents: mcpAgents } : undefined,
  };
  manifest.paths = [
    ...manifest.corpora,
    current,
    ...(manifest.mcp ? [mcpServerDir(ctx)] : []),
    ...Object.values(agents).flatMap((a) => a.skills.map((s) => path.join(a.skillsDir, s))),
  ];
  act(`record ${manifest.paths.length} paths in ${path.join(ctx.dataDir, MANIFEST)}`);
  if (!ctx.dryRun) {
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.dataDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const done = agentNames.map((a) => ctx.agents[a].label).join(', ');
  say(
    `${ctx.dryRun ? 'dry run: nothing written. ' : ''}genesis-set ${ctx.version}: ` +
      `${plural(skills.names.length, 'skill')} for ${done}; corpus at ${corpusDir}` +
      (mcp ? `; MCP server for ${plural(mcpRegistered, 'agent')}` : '') +
      (blocked ? `; ${plural(blocked, 'skill')} skipped` : ''),
  );
  return blocked ? 1 : 0;
}

/** Install, then delete every corpus version no installed skill points at. */
export function update(ctx, agentNames, opts = {}) {
  const code = install(ctx, agentNames, opts);
  if (code !== 0 && !readManifest(ctx)) return code;
  const manifest = readManifest(ctx);
  const keep = new Set([path.join(ctx.dataDir, ctx.version)]);
  for (const a of Object.values(manifest?.agents ?? {})) if (a.corpus) keep.add(a.corpus);
  let entries = [];
  try {
    entries = fs.readdirSync(ctx.dataDir, { withFileTypes: true });
  } catch {
    // nothing installed yet (dry run)
  }
  const removed = [];
  for (const e of entries) {
    if (!e.isDirectory() || !VERSION_DIR.test(e.name)) continue;
    const dir = path.join(ctx.dataDir, e.name);
    if (keep.has(dir)) continue;
    ctx.out(`${ctx.dryRun ? 'would ' : ''}remove old corpus ${dir}`);
    if (!ctx.dryRun) remove(dir);
    removed.push(dir);
  }
  if (manifest && removed.length && !ctx.dryRun) {
    manifest.corpora = (manifest.corpora ?? []).filter((c) => !removed.includes(c));
    manifest.paths = (manifest.paths ?? []).filter((p) => !removed.includes(p));
    fs.writeFileSync(path.join(ctx.dataDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return code;
}

/** Removes exactly what the manifest lists; mind-set is never touched. */
export function uninstall(ctx) {
  const manifest = readManifest(ctx);
  if (!manifest) {
    ctx.out(`nothing to uninstall: no ${path.join(ctx.dataDir, MANIFEST)}`);
    return 0;
  }
  const act = (msg) => ctx.out(`${ctx.dryRun ? 'would ' : ''}${msg}`);
  for (const name of Object.keys(manifest.mcp?.agents ?? {})) {
    if (!UNREGISTER[name]) continue;
    const r = UNREGISTER[name](ctx);
    if (r.status === 'removed') act(r.message);
    else ctx.out(r.message);
  }
  const skillDirs = new Set(
    Object.values(manifest.agents ?? {}).flatMap((a) => (a.skills ?? []).map((s) => path.join(a.skillsDir, s))),
  );
  const inData = (p) => {
    const rel = path.relative(ctx.dataDir, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  for (const p of manifest.paths ?? []) {
    if (!exists(p)) continue;
    if (skillDirs.has(p)) {
      if (!readMarker(p)) {
        ctx.out(`keep ${p}: it no longer carries the genesis-set marker`);
        continue;
      }
    } else if (!inData(p)) {
      ctx.out(`keep ${p}: outside ${ctx.dataDir} and not a genesis-set skill`);
      continue;
    }
    act(`remove ${p}`);
    if (!ctx.dryRun) remove(p);
  }
  act(`remove ${path.join(ctx.dataDir, MANIFEST)}`);
  if (!ctx.dryRun) {
    remove(path.join(ctx.dataDir, MANIFEST));
    try {
      const left = fs.readdirSync(ctx.dataDir);
      if (left.length === 0) fs.rmdirSync(ctx.dataDir);
      else ctx.out(`kept ${ctx.dataDir} (it still holds: ${left.join(', ')})`);
    } catch {
      // already gone
    }
  }
  ctx.out(
    `${ctx.dryRun ? 'dry run: nothing removed. ' : ''}genesis-set uninstalled; mind-set is left as it is ` +
      '("mind-set uninstall" removes it)' +
      (exists(path.join(ctx.dataDir, 'config.json')) ? `; your API key file ${path.join(ctx.dataDir, 'config.json')} is kept ("genesis-set config unset-key" clears it)` : ''),
  );
  return 0;
}

function configFileMode(file) {
  if (process.platform === 'win32') return null;
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return null;
  }
}

/** Prints what is installed where, both versions and whether they fit. Exit 1 when something is wrong. */
export function doctor(ctx) {
  const say = ctx.out;
  const detected = detectAgents(ctx);
  const manifest = readManifest(ctx);
  const problems = [];
  say(`genesis-set ${ctx.version} (this package)`);
  say(`data folder: ${ctx.dataDir}`);
  if (manifest) {
    const ok = manifest.corpus && exists(manifest.corpus);
    say(`corpus: ${manifest.version} at ${manifest.corpus}${ok ? '' : ' (MISSING)'}`);
    if (!ok) problems.push(`corpus folder ${manifest.corpus} is missing`);
    if (manifest.version !== ctx.version) say(`note: installed ${manifest.version}, this package is ${ctx.version}; run "genesis-set update"`);
  } else {
    say('corpus: not installed (run "genesis-set install")');
  }
  const st = mindSetState(ctx);
  const range = ctx.mindSetRange ?? 'any';
  const verdict = {
    ok: 'compatible',
    missing: 'NOT INSTALLED',
    old: 'INCOMPATIBLE (older; "genesis-set update" updates it)',
    incompatible: 'INCOMPATIBLE',
  }[st.state];
  say(`mind-set: ${st.version ?? 'not installed'} at ${ctx.mindSetDir}; genesis-set needs ${range}: ${verdict}`);
  if (st.state !== 'ok') problems.push(`mind-set ${st.version ?? 'is missing'}: genesis-set ${ctx.version} needs ${range}`);
  const bundled = bundledMindSet(ctx);
  say(`mind-set package shipped with genesis-set: ${bundled ? `${bundled.version} (${bundled.dir})` : 'not found'}`);
  if (manifest && !exists(mindSetCorpus(ctx))) problems.push(`the mind-set corpus ${mindSetCorpus(ctx)} the skills point at is missing`);
  const settings = resolveSettings(ctx.env);
  say(
    `Genesis Compiler API key: ${settings.apiKey ? `set (from ${settings.keySource})` : `not set (${API_KEY_ENV}, or "genesis-set config set-key"; create one at ${portalKeysUrl(settings.apiBase)})`}; ` +
      'its value is never printed',
  );
  say(`Genesis Compiler API base: ${settings.apiBase} (${settings.baseSource})`);
  for (const p of settings.problems) problems.push(p);
  const cfgMode = configFileMode(settings.configFile);
  if (cfgMode !== null && (cfgMode & 0o077) !== 0) {
    problems.push(`${settings.configFile} is readable by other users (mode ${cfgMode.toString(8)}); run "chmod 600 ${settings.configFile}"`);
  }
  if (manifest?.mcp) {
    const ok = exists(mcpServerFile(ctx));
    say(`MCP server: ${mcpServerFile(ctx)}${ok ? '' : ' (MISSING)'}`);
    if (!ok) problems.push(`the MCP server ${mcpServerFile(ctx)} is missing`);
  } else {
    say('MCP server: not installed (run "genesis-set install")');
  }
  say('agents:');
  for (const name of ['claude', 'codex']) {
    const agent = ctx.agents[name];
    const how = detected[name] ? `detected (${detected[name]})` : 'not detected';
    say(`  ${agent.label}: ${how}; skills folder ${agent.skillsDir}`);
    const ours = [];
    const theirs = [];
    try {
      for (const d of fs.readdirSync(agent.skillsDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = path.join(agent.skillsDir, d.name);
        const g = readMarker(dir);
        if (g) ours.push(`${d.name} (${g.version})`);
        const m = readMarker(dir, MIND_SET_MARKER, 'mind-set');
        if (m) theirs.push(`${d.name} (${m.version})`);
      }
    } catch {
      // no skills folder
    }
    say(`    genesis-set skills: ${ours.length ? ours.sort().join(', ') : 'none'}`);
    say(`    mind-set skills: ${theirs.length ? theirs.sort().join(', ') : 'none'}`);
    const reg = REGISTRATION[name](ctx);
    say(`    MCP server "genesis": ${reg}`);
    if (manifest?.mcp?.agents?.[name] && reg !== 'registered') problems.push(`${agent.label}: the genesis MCP server is ${reg}`);
    for (const s of manifest?.agents?.[name]?.skills ?? []) {
      if (!readMarker(path.join(agent.skillsDir, s))) problems.push(`${agent.label} skill ${s} is in the manifest but missing or replaced`);
    }
    if (manifest?.agents?.[name] && theirs.length === 0) problems.push(`${agent.label} has genesis-set skills but no mind-set skills`);
  }
  if (problems.length) {
    say('problems:');
    for (const p of problems) say(`  - ${p}`);
    say('run "genesis-set install" (or "genesis-set update") to repair');
    return 1;
  }
  return 0;
}
