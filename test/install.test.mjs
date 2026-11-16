import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { cleanup, exists, makeHome, makeMindSet, makePackage, readJson, run } from './helpers.mjs';

after(cleanup);

const SKILLS = ['genesis-demo-api', 'genesis-demo-code'];
const claudeSkill = (home, s) => path.join(home, '.claude', 'skills', s);
const codexSkill = (home, s) => path.join(home, '.agents', 'skills', s);
const manifestOf = (home) => readJson(path.join(home, '.genesis-set', 'installed.json'));
const mindSetOf = (home) => readJson(path.join(home, '.mind-set', 'installed.json'));

describe('install', () => {
  test('one command installs mind-set when it is missing, then genesis-set, for Claude Code and Codex', () => {
    const pkg = makePackage('0.1.0');
    const mindSet = makeMindSet('0.1.0');
    const home = makeHome({ claude: true, codex: true });
    const res = run(pkg, home, ['install'], { mindSet });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /mind-set is not installed: installing mind-set 0\.1\.0/);

    assert.equal(mindSetOf(home).version, '0.1.0');
    assert.deepEqual(Object.keys(mindSetOf(home).agents).sort(), ['claude', 'codex']);

    const corpus = path.join(home, '.genesis-set', '0.1.0');
    const current = path.join(home, '.genesis-set', 'current');
    assert.equal(fs.realpathSync(current), fs.realpathSync(corpus));
    const mindSetCorpus = path.join(home, '.mind-set', 'current');
    for (const dir of [claudeSkill, codexSkill]) {
      const api = fs.readFileSync(path.join(dir(home, 'genesis-demo-api'), 'SKILL.md'), 'utf8');
      assert.ok(api.includes(`${corpus}/genesis/compiler-api.md`), api);
      assert.ok(api.includes(`${mindSetCorpus}/procedures/specs.md`), api);
      assert.ok(!api.includes('{{CORPUS}}') && !api.includes('{{MIND_SET}}'));
      assert.ok(exists(path.join(mindSetCorpus, 'procedures', 'specs.md')), 'the mind-set path a skill names exists');
      const notes = fs.readFileSync(path.join(dir(home, 'genesis-demo-code'), 'references', 'notes.md'), 'utf8');
      assert.ok(notes.includes(corpus) && notes.includes(mindSetCorpus), 'nested markdown is filled too');
      const marker = readJson(path.join(dir(home, 'genesis-demo-api'), '.genesis-set.json'));
      assert.deepEqual(marker, { package: 'genesis-set', version: '0.1.0', corpus, mindSet: mindSetCorpus });
      // mind-set's own skill sits next to ours, written by mind-set
      assert.equal(readJson(path.join(path.dirname(dir(home, 'x')), 'openappl-demo', '.mind-set.json')).package, 'mind-set');
    }
    const manifest = manifestOf(home);
    assert.equal(manifest.mindSetRange, '^0.1.0');
    for (const s of SKILLS) assert.ok(manifest.paths.includes(claudeSkill(home, s)));
  });

  test('a compatible mind-set is left alone', () => {
    const pkg = makePackage('0.1.0');
    const home = makeHome({ claude: true });
    assert.equal(run(pkg, home, ['install'], { mindSet: makeMindSet('0.1.0') }).code, 0);
    const before = fs.readFileSync(path.join(home, '.mind-set', 'installed.json'), 'utf8');
    const res = run(pkg, home, ['install'], { mindSet: makeMindSet('0.1.5') });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /mind-set 0\.1\.0 is installed \(genesis-set needs \^0\.1\.0\)/);
    assert.equal(fs.readFileSync(path.join(home, '.mind-set', 'installed.json'), 'utf8'), before);
  });

  test('an older mind-set is updated with the bundled one', () => {
    const pkg = makePackage('0.2.0', { range: '^0.2.0' });
    const home = makeHome({ claude: true });
    assert.equal(run(makePackage('0.1.0'), home, ['install'], { mindSet: makeMindSet('0.1.0') }).code, 0);
    const res = run(pkg, home, ['install'], { mindSet: makeMindSet('0.2.1') });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /mind-set 0\.1\.0 is older than \^0\.2\.0: updating to 0\.2\.1/);
    assert.equal(mindSetOf(home).version, '0.2.1');
  });

  test('a newer, incompatible mind-set is never downgraded and stops the install', () => {
    const home = makeHome({ claude: true });
    assert.equal(run(makePackage('0.1.0'), home, ['install'], { mindSet: makeMindSet('0.1.0') }).code, 0);
    // a later mind-set 0.3.0 installed by the user
    const m = mindSetOf(home);
    fs.writeFileSync(path.join(home, '.mind-set', 'installed.json'), JSON.stringify({ ...m, version: '0.3.0' }));
    const res = run(makePackage('0.1.1'), home, ['install'], { mindSet: makeMindSet('0.1.0') });
    assert.equal(res.code, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /mind-set 0\.3\.0 is installed but genesis-set 0\.1\.1 needs \^0\.1\.0/);
    assert.equal(mindSetOf(home).version, '0.3.0');
  });

  test('no mind-set anywhere: a clear error and nothing written', () => {
    const home = makeHome({ claude: true });
    const res = run(makePackage(), home, ['install']);
    assert.equal(res.code, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /mind-set is not installed and the mind-set package that comes with genesis-set was not found/);
    assert.ok(!exists(path.join(home, '.genesis-set')));
  });

  test('never replaces a mind-set skill, not even with --force', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true });
    const clash = claudeSkill(home, 'genesis-demo-api');
    fs.mkdirSync(clash, { recursive: true });
    fs.writeFileSync(path.join(clash, '.mind-set.json'), JSON.stringify({ package: 'mind-set', version: '0.1.0' }));
    fs.writeFileSync(path.join(clash, 'SKILL.md'), 'mind-set owns this');
    const res = run(pkg, home, ['install', '--force'], { mindSet: makeMindSet() });
    assert.equal(res.code, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /belongs to mind-set and is never replaced/);
    assert.equal(fs.readFileSync(path.join(clash, 'SKILL.md'), 'utf8'), 'mind-set owns this');
    assert.ok(exists(path.join(claudeSkill(home, 'genesis-demo-code'), '.genesis-set.json')));
  });

  test('a foreign folder is skipped, and replaced with --force after a backup', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true });
    const clash = claudeSkill(home, 'genesis-demo-api');
    fs.mkdirSync(clash, { recursive: true });
    fs.writeFileSync(path.join(clash, 'SKILL.md'), 'mine');
    assert.equal(run(pkg, home, ['install'], { mindSet: makeMindSet() }).code, 1);
    assert.equal(fs.readFileSync(path.join(clash, 'SKILL.md'), 'utf8'), 'mine');
    assert.equal(run(pkg, home, ['install', '--force'], { mindSet: makeMindSet() }).code, 0);
    const backups = fs.readdirSync(path.join(home, '.genesis-set', 'backup'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(home, '.genesis-set', 'backup', backups[0], 'SKILL.md'), 'utf8'), 'mine');
  });

  test('writes nothing into the project folder it runs from', () => {
    const home = makeHome({ claude: true });
    const project = path.join(home, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'blueprint.json'), '{}');
    const res = run(makePackage(), home, ['install'], { mindSet: makeMindSet(), cwd: project, env: { GENESIS_API_KEY: 'secret-value' } });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.deepEqual(fs.readdirSync(project), ['blueprint.json']);
    const everything = JSON.stringify(manifestOf(home)) + res.stdout;
    assert.ok(!everything.includes('secret-value'), 'the API key is never written or printed');
  });

  test('--dry-run writes nothing, mind-set included', () => {
    const home = makeHome({ claude: true, codex: true });
    const res = run(makePackage(), home, ['install', '--dry-run'], { mindSet: makeMindSet() });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /dry run: nothing written/);
    assert.ok(!exists(path.join(home, '.genesis-set')) && !exists(path.join(home, '.mind-set')));
  });
});

describe('update, uninstall, doctor', () => {
  test('doctor reports both versions and that they are compatible', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true });
    assert.equal(run(pkg, home, ['install'], { mindSet: makeMindSet() }).code, 0);
    const res = run(pkg, home, ['doctor'], { mindSet: makeMindSet() });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /genesis-set 0\.1\.0 \(this package\)/);
    assert.match(res.stdout, /mind-set: 0\.1\.0 at .*; genesis-set needs \^0\.1\.0: compatible/);
    assert.match(res.stdout, /GENESIS_API_KEY is not set/);
    assert.match(res.stdout, /genesis-set skills: genesis-demo-api \(0\.1\.0\), genesis-demo-code \(0\.1\.0\)/);
    assert.match(res.stdout, /mind-set skills: openappl-demo \(0\.1\.0\)/);
  });

  test('doctor fails on an incompatible mind-set and on a missing one', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true });
    assert.equal(run(pkg, home, ['doctor']).code, 1);
    assert.equal(run(pkg, home, ['install'], { mindSet: makeMindSet() }).code, 0);
    const m = mindSetOf(home);
    fs.writeFileSync(path.join(home, '.mind-set', 'installed.json'), JSON.stringify({ ...m, version: '1.0.0' }));
    const res = run(pkg, home, ['doctor']);
    assert.equal(res.code, 1, res.stdout);
    assert.match(res.stdout, /mind-set: 1\.0\.0 .*: INCOMPATIBLE/);
  });

  test('update removes older corpora; uninstall removes genesis-set and keeps mind-set', () => {
    const home = makeHome({ claude: true });
    assert.equal(run(makePackage('0.1.0'), home, ['install'], { mindSet: makeMindSet() }).code, 0);
    assert.equal(run(makePackage('0.1.1'), home, ['update'], { mindSet: makeMindSet() }).code, 0);
    assert.ok(!exists(path.join(home, '.genesis-set', '0.1.0')));
    assert.ok(exists(path.join(home, '.genesis-set', '0.1.1')));
    const un = run(makePackage('0.1.1'), home, ['uninstall']);
    assert.equal(un.code, 0, un.stdout + un.stderr);
    for (const s of SKILLS) assert.ok(!exists(claudeSkill(home, s)));
    assert.ok(!exists(path.join(home, '.genesis-set')));
    assert.ok(exists(path.join(home, '.mind-set', 'installed.json')), 'mind-set stays');
    assert.ok(exists(claudeSkill(home, 'openappl-demo')), 'the mind-set skill stays');
  });

  test('refuses a skill without the genesis- prefix', () => {
    const pkg = makePackage();
    fs.cpSync(path.join(pkg, 'skills', 'genesis-demo-api'), path.join(pkg, 'skills', 'openappl-demo'), { recursive: true });
    const res = run(pkg, makeHome({ claude: true }), ['install'], { mindSet: makeMindSet() });
    assert.equal(res.code, 1);
    assert.match(res.stdout, /skill names must start with "genesis-": openappl-demo/);
  });
});
