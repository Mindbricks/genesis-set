// `genesis init` (#9383): a project folder the agent reads as OpenAPPL + Genesis from its first
// session. CLAUDE.md / AGENTS.md get a marked block (the user's content is kept, a second run
// changes nothing), design/ and the env lines of .gitignore; the output names the key status
// and a starter prompt. --dry-run writes nothing.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { BLOCK_BEGIN, BLOCK_END, GITIGNORE_LINES, STARTER_PROMPT } from '../lib/init.mjs';
import { cleanup, makeHome, makePackage, run, tempDir } from './helpers.mjs';

after(cleanup);

const PKG = makePackage();
const read = (f) => fs.readFileSync(f, 'utf8');
const blocks = (text) => text.split(BLOCK_BEGIN).length - 1;
const init = (args, opts = {}) => run(PKG, opts.home ?? makeHome(), ['init', ...args], opts);

describe('genesis init', () => {
  test('an empty folder gets both instruction files, design/ and .gitignore, the key status and a starter prompt', () => {
    const dir = path.join(tempDir(), 'shop');
    const res = init([dir]);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const text = read(path.join(dir, name));
      assert.equal(blocks(text), 1, name);
      assert.ok(text.includes(BLOCK_END), name);
      for (const skill of ['openappl-blueprint-design', 'openappl-blueprint-authoring', 'openappl-blueprint-review', 'genesis-compiler-api', 'genesis-run-and-test', 'genesis-deploy', 'openappl-blueprint-contract']) {
        assert.ok(text.includes(skill), `${name} names ${skill}`);
      }
      assert.match(text, /never ask for a key or a password in the chat/);
      assert.match(text, /Never hand-write backend code/);
      assert.match(text, /strongly recommended, for the quality of the blueprint/);
      assert.match(text, /not a rule of the OpenAPPL standard, which\s+requires only the blueprint/);
      assert.match(text, /Only if the user explicitly asks to skip the design documents/);
      assert.match(text, /The mail sink is infrastructure like the database/);
      assert.match(text, /Never edit generated env to reach it/);
    }
    assert.ok(fs.existsSync(path.join(dir, 'design', 'README.md')));
    const identity = JSON.parse(read(path.join(dir, '.genesis', 'project.json')));
    assert.equal(identity.name, 'shop');
    assert.match(res.stdout, new RegExp(`Project "shop" \\(id ${identity.id}\\)`));
    const ignore = read(path.join(dir, '.gitignore')).split('\n');
    for (const l of GITIGNORE_LINES) assert.ok(ignore.includes(l), l);
    assert.match(res.stdout, /Genesis API key: not set\. Create one at https:\/\/portal\.genesiscompiler\.com\/keys/);
    assert.match(res.stdout, /not a git repository yet/);
    assert.ok(res.stdout.includes(STARTER_PROMPT));
  });

  test('a second run changes nothing', () => {
    const dir = tempDir();
    assert.equal(init([dir]).code, 0);
    const before = Object.fromEntries(['CLAUDE.md', 'AGENTS.md', '.gitignore', 'design/README.md', '.genesis/project.json'].map((f) => [f, read(path.join(dir, f))]));
    const again = init([dir]);
    assert.equal(again.code, 0);
    assert.match(again.stdout, /CLAUDE\.md: up to date/);
    assert.match(again.stdout, /AGENTS\.md: up to date/);
    assert.doesNotMatch(again.stdout, /^(write|add|update) /m);
    for (const [f, text] of Object.entries(before)) assert.equal(read(path.join(dir, f)), text, f);
  });

  test("the user's own content is kept; an old block is replaced, never duplicated", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My rules\n\nUse tabs.\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Mine\n\nBefore.\n\n${BLOCK_BEGIN}\nan old block\n${BLOCK_END}\n\nAfter.\n`);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n.env\n');
    const res = init([dir]);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /add the genesis block to CLAUDE\.md \(your content is kept\)/);
    assert.match(res.stdout, /update the genesis block in AGENTS\.md/);
    const claude = read(path.join(dir, 'CLAUDE.md'));
    assert.ok(claude.startsWith('# My rules\n\nUse tabs.\n'));
    assert.equal(blocks(claude), 1);
    const agents = read(path.join(dir, 'AGENTS.md'));
    assert.ok(agents.startsWith('# Mine\n\nBefore.\n\n') && agents.endsWith('\n\nAfter.\n'));
    assert.doesNotMatch(agents, /an old block/);
    assert.equal(blocks(agents), 1);
    const ignore = read(path.join(dir, '.gitignore'));
    assert.ok(ignore.startsWith('dist/\n.env\n'));
    assert.equal(ignore.split('\n').filter((l) => l === '.env').length, 1, '.env is not added twice');
    for (const l of GITIGNORE_LINES) assert.ok(ignore.split('\n').includes(l), l);
  });

  test('--dry-run says what it would do and writes nothing', () => {
    const dir = path.join(tempDir(), 'new-project');
    const res = init([dir, '--dry-run']);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /would create /);
    assert.match(res.stdout, /would write CLAUDE\.md/);
    assert.ok(!fs.existsSync(dir));
  });

  test('a set key is shown masked, never whole; a git repository gets no git hint', () => {
    const dir = tempDir();
    spawnSync('git', ['init', '-q', dir]);
    const key = ['sk', 'mbx', `${'a'.repeat(20)}9f3a`].join('_');
    const res = init([dir], { env: { GENESIS_API_KEY: key } });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /Genesis API key: sk_mbx_\.\.\.9f3a \(from GENESIS_API_KEY\)/);
    assert.ok(!res.stdout.includes(key));
    assert.doesNotMatch(res.stdout, /git repository/);
  });

  test('the current folder by default; a file or two folders are refused', () => {
    const dir = tempDir();
    assert.equal(init([], { cwd: dir }).code, 0);
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
    const file = path.join(tempDir(), 'x.txt');
    fs.writeFileSync(file, '');
    assert.equal(init([file]).code, 1);
    assert.equal(init([tempDir(), tempDir()]).code, 2);
  });
});
