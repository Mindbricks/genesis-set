// End to end: `npm pack` the built package, install the tarball (with a
// mind-set tarball beside it: the fake fixture until mind-set is on npm) into a
// throwaway project, and run the installed CLI against a fake HOME. The
// installed genesis-set finds mind-set as its npm dependency.
//
// The package under test is GENESIS_SET_PACKAGE, or this test's own package
// when it has a corpus/ (the public repository, or dist-genesis-set/). In the
// source folder genesis-set/ there is no corpus until `npm run build:genesis-set`,
// so the suite is skipped there; `npm run test:genesis-set-pack` builds and runs it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { FIXTURES, PKG_DIR, cleanup, exists, makeHome, readJson, run, tempDir } from './helpers.mjs';

after(cleanup);

const PACKAGE = process.env.GENESIS_SET_PACKAGE
  ? path.resolve(process.env.GENESIS_SET_PACKAGE)
  : exists(path.join(PKG_DIR, 'corpus')) ? PKG_DIR : null;

function npm(args, cwd) {
  const res = spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_offline: 'true',
    },
  });
  assert.equal(res.status, 0, `npm ${args.join(' ')}\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

function skillsOf(pkgRoot) {
  return fs
    .readdirSync(path.join(pkgRoot, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Absolute paths below `root` that a text names. */
function pathsUnder(text, root) {
  const esc = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set([...text.matchAll(new RegExp(`${esc}/([A-Za-z0-9_./-]*)`, 'g'))].map((m) => m[1].replace(/[.]+$/, '')).filter(Boolean))];
}

describe('npm pack, installed from the tarball', { skip: PACKAGE ? false : 'no built package (npm run test:genesis-set-pack)' }, () => {
  const work = PACKAGE ? tempDir('genesis-set-pack-') : null;
  let installed;

  test('the tarball holds the package and not the tests', () => {
    const [info] = JSON.parse(npm(['pack', PACKAGE, '--json', '--pack-destination', work], work));
    const files = new Set(info.files.map((f) => f.path));
    for (const f of ['package.json', 'bin/genesis-set.mjs', 'lib/install.mjs', 'lib/semver.mjs', 'LICENSE', 'README.md', 'CHANGELOG.md', 'corpus/README.md', 'corpus/genesis/compiler-api.md', 'corpus/genesis/procedures/README.md']) {
      assert.ok(files.has(f), `${f} is not in the tarball`);
    }
    const skills = skillsOf(PACKAGE);
    assert.ok(skills.length >= 2 && skills.every((s) => s.startsWith('genesis-')), skills.join(', '));
    for (const s of skills) assert.ok(files.has(`skills/${s}/SKILL.md`));
    assert.ok(![...files].some((f) => f.startsWith('test/')), 'the tests are in the tarball');
    assert.match(fs.readFileSync(path.join(PACKAGE, 'README.md'), 'utf8'), /PRE-RELEASE/);

    const [ms] = JSON.parse(npm(['pack', path.join(FIXTURES, 'mind-set'), '--json', '--pack-destination', work], work));
    const project = path.join(work, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), '{ "name": "probe", "private": true }\n');
    npm(['install', '--no-package-lock', path.join(work, ms.filename), path.join(work, info.filename)], project);
    installed = path.join(project, 'node_modules', '@mindbricks', 'genesis-set');
    assert.equal(readJson(path.join(installed, 'package.json')).version, info.version);
  });

  test('install brings mind-set and every genesis-set skill, with corpus paths that exist', () => {
    const home = makeHome({ claude: true, codex: true });
    const res = run(installed, home, ['install']);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /installing mind-set/);
    const version = readJson(path.join(installed, 'package.json')).version;
    const corpus = path.join(home, '.genesis-set', version);
    const mindSet = path.join(home, '.mind-set', 'current');
    for (const agentDir of [path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')]) {
      for (const s of skillsOf(installed)) {
        const text = fs.readFileSync(path.join(agentDir, s, 'SKILL.md'), 'utf8');
        assert.ok(!text.includes('{{CORPUS}}') && !text.includes('{{MIND_SET}}'), `${s}: placeholder left`);
        const named = pathsUnder(text, corpus);
        assert.ok(named.length > 0, `${s} names no corpus file`);
        for (const rel of named) assert.ok(exists(path.join(corpus, rel)), `${s}: ${rel} is not in the installed corpus`);
      }
    }
    assert.ok(exists(mindSet));
    const doc = run(installed, home, ['doctor']);
    assert.equal(doc.code, 0, doc.stdout + doc.stderr);
    assert.match(doc.stdout, /compatible/);
    const un = run(installed, home, ['uninstall']);
    assert.equal(un.code, 0, un.stdout + un.stderr);
    assert.ok(!exists(corpus));
    assert.ok(exists(path.join(home, '.mind-set', 'installed.json')), 'mind-set stays');
  });
});
