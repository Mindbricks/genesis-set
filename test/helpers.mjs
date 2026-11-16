// Shared helpers for the genesis-set CLI tests: a throwaway package built from
// the real bin/ and lib/ plus the fixture corpus and skills, a fake mind-set
// package (fixtures/mind-set), a fake HOME, and a runner with a clean environment.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = path.resolve(TEST_DIR, '..');
export const FIXTURES = path.join(TEST_DIR, 'fixtures');

const tempRoots = [];

export function tempDir(prefix = 'genesis-set-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

export function cleanup() {
  for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** A package folder with this checkout's bin/ and lib/, the given version and mind-set range, and the fixture corpus and skills. */
export function makePackage(version = '0.1.0', { range = '^0.1.0' } = {}) {
  const root = tempDir('genesis-set-pkg-');
  fs.cpSync(path.join(PKG_DIR, 'bin'), path.join(root, 'bin'), { recursive: true });
  fs.cpSync(path.join(PKG_DIR, 'lib'), path.join(root, 'lib'), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ ...pkg, version, dependencies: { '@mindbricks/mind-set': range } }, null, 2),
  );
  fs.cpSync(path.join(FIXTURES, 'package', 'corpus'), path.join(root, 'corpus'), { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'package', 'skills'), path.join(root, 'skills'), { recursive: true });
  return root;
}

/** A copy of the fake mind-set package at the given version. */
export function makeMindSet(version = '0.1.0') {
  const root = tempDir('genesis-set-mindset-');
  fs.cpSync(path.join(FIXTURES, 'mind-set'), root, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2));
  return root;
}

/** A fake HOME; `claude` / `codex` create the agents' config folders. */
export function makeHome({ claude = false, codex = false } = {}) {
  const home = tempDir('genesis-set-home-');
  if (claude) fs.mkdirSync(path.join(home, '.claude'));
  if (codex) fs.mkdirSync(path.join(home, '.codex'));
  fs.mkdirSync(path.join(home, 'bin'));
  return home;
}

/** Runs the CLI of `pkgRoot` with HOME = `home` (and the fake mind-set when given), nothing else inherited. */
export function run(pkgRoot, home, args, { mindSet, env = {}, cwd } = {}) {
  const e = { HOME: home, USERPROFILE: home, PATH: path.join(home, 'bin'), ...env };
  if (mindSet) e.GENESIS_SET_MIND_SET_PACKAGE = mindSet;
  if (process.env.SYSTEMROOT) e.SYSTEMROOT = process.env.SYSTEMROOT;
  const res = spawnSync(process.execPath, [path.join(pkgRoot, 'bin', 'genesis-set.mjs'), ...args], {
    env: e,
    encoding: 'utf8',
    cwd: cwd ?? home,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
