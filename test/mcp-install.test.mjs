// `genesis install` registers the MCP server with Claude Code and Codex at
// user scope (#9183), `uninstall` removes exactly that, and `genesis config`
// keeps the API key in the home config file (0600) without ever printing it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { cleanup, exists, makeHome, makeMindSet, makePackage, readJson, run, tempDir } from './helpers.mjs';

after(cleanup);

const claudeJson = (home) => path.join(home, '.claude.json');
const codexToml = (home) => path.join(home, '.codex', 'config.toml');
const serverOf = (home) => path.join(home, '.genesis-set', 'mcp', 'server.mjs');

function installBoth(extra = [], env = {}) {
  const pkg = makePackage();
  const home = makeHome({ claude: true, codex: true });
  const res = run(pkg, home, ['install', ...extra], { mindSet: makeMindSet(), env });
  return { pkg, home, res };
}

/** initialize + tools/list against a server file, over stdio, in one go. */
function listTools(command, args, env) {
  const input =
    [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]
      .map((m) => JSON.stringify(m))
      .join('\n') + '\n';
  const res = spawnSync(command, args, { input, encoding: 'utf8', env });
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
  return lines.find((l) => l.id === 2).result.tools.map((t) => t.name).sort();
}

describe('MCP registration at install', () => {
  test('install copies the server and registers it for Claude Code and Codex, keeping what was there', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true, codex: true });
    fs.writeFileSync(claudeJson(home), JSON.stringify({ numStartups: 3, mcpServers: { other: { type: 'stdio', command: 'x' } }, projects: { '/p': {} } }));
    fs.writeFileSync(codexToml(home), 'model = "gpt-x"\n\n[mcp_servers.other]\ncommand = "y"\n');
    const res = run(pkg, home, ['install'], { mindSet: makeMindSet() });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /MCP server for 2 agents/);

    const cfg = readJson(claudeJson(home));
    assert.equal(cfg.numStartups, 3);
    assert.deepEqual(cfg.projects, { '/p': {} });
    assert.deepEqual(cfg.mcpServers.other, { type: 'stdio', command: 'x' });
    assert.deepEqual(cfg.mcpServers.genesis, { type: 'stdio', command: process.execPath, args: [serverOf(home)], env: {} });

    const toml = fs.readFileSync(codexToml(home), 'utf8');
    assert.ok(toml.startsWith('model = "gpt-x"\n\n[mcp_servers.other]\ncommand = "y"\n'), toml);
    assert.match(toml, /\[mcp_servers\.genesis\]\ncommand = ".+"\nargs = \[".+server\.mjs"\]/);
    assert.ok(toml.includes(JSON.stringify(serverOf(home))));

    // the registered command really serves the five API tools, the two design system tools, the delivery tool, the four key tools and the board tool
    assert.deepEqual(listTools(process.execPath, [serverOf(home)], { HOME: home, PATH: process.env.PATH }), [
      'genesis_applyDesignSystem',
      'genesis_buildDiagrams',
      'genesis_buildService',
      'genesis_deliverService',
      'genesis_getBuilds',
      'genesis_getServiceBuild',
      'genesis_listDesignSystems',
      'genesis_listKeys',
      'genesis_openBoard',
      'genesis_openKeyManager',
      'genesis_requestKey',
      'genesis_validateApplication',
      'genesis_validateService',
      'genesis_writeKeyToEnvFile',
    ]);
    assert.equal(readJson(path.join(home, '.genesis-set', 'mcp', 'version.json')).version, '0.1.0');
    const manifest = readJson(path.join(home, '.genesis-set', 'installed.json'));
    assert.deepEqual(Object.keys(manifest.mcp.agents).sort(), ['claude', 'codex']);

    // nothing in the folder the command ran in
    assert.deepEqual(fs.readdirSync(home).filter((f) => !['.claude', '.codex', '.agents', '.claude.json', '.genesis-set', '.mind-set', 'bin'].includes(f)), []);

    const doc = run(pkg, home, ['doctor'], { mindSet: makeMindSet() });
    assert.equal(doc.code, 0, doc.stdout);
    assert.equal((doc.stdout.match(/MCP server "genesis": registered/g) ?? []).length, 2);
  });

  test('installing again leaves one entry and one block', () => {
    const { pkg, home } = installBoth();
    assert.equal(run(pkg, home, ['install'], { mindSet: makeMindSet() }).code, 0);
    assert.equal(run(pkg, home, ['update'], { mindSet: makeMindSet() }).code, 0);
    const toml = fs.readFileSync(codexToml(home), 'utf8');
    assert.equal((toml.match(/\[mcp_servers\.genesis\]/g) ?? []).length, 1, toml);
    assert.equal((toml.match(/# >>> genesis-set/g) ?? []).length, 1);
    assert.deepEqual(Object.keys(readJson(claudeJson(home)).mcpServers), ['genesis']);
  });

  test('GENESIS_SET_HOME is handed to the server in both registrations', () => {
    const data = path.join(tempDir(), 'gs-data');
    const { home, res } = installBoth([], { GENESIS_SET_HOME: data });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    const entry = readJson(claudeJson(home)).mcpServers.genesis;
    assert.deepEqual(entry.env, { GENESIS_SET_HOME: data });
    assert.equal(entry.args[0], path.join(data, 'mcp', 'server.mjs'));
    assert.match(fs.readFileSync(codexToml(home), 'utf8'), /\[mcp_servers\.genesis\.env\]\nGENESIS_SET_HOME = ".+gs-data"/);
  });

  test('a foreign "genesis" server is never replaced silently', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true, codex: true });
    const foreign = { type: 'stdio', command: 'someone-else' };
    fs.writeFileSync(claudeJson(home), JSON.stringify({ mcpServers: { genesis: foreign } }));
    fs.writeFileSync(codexToml(home), '[mcp_servers.genesis]\ncommand = "someone-else"\n');
    const res = run(pkg, home, ['install'], { mindSet: makeMindSet() });
    assert.equal(res.code, 1, res.stdout);
    assert.match(res.stdout, /skip Claude Code MCP server: .*did not write \(use --force/);
    assert.match(res.stdout, /skip Codex MCP server: .*outside the genesis-set block/);
    assert.deepEqual(readJson(claudeJson(home)).mcpServers.genesis, foreign);
    assert.equal(fs.readFileSync(codexToml(home), 'utf8'), '[mcp_servers.genesis]\ncommand = "someone-else"\n');

    const forced = run(pkg, home, ['install', '--force', '--claude'], { mindSet: makeMindSet() });
    assert.equal(forced.code, 0, forced.stdout);
    assert.equal(readJson(claudeJson(home)).mcpServers.genesis.args[0], serverOf(home));
    const backups = fs.readdirSync(path.join(home, '.genesis-set', 'backup')).filter((f) => f.startsWith('claude-mcp-genesis-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(readJson(path.join(home, '.genesis-set', 'backup', backups[0])), foreign);
  });

  test('a ~/.claude.json that is not JSON is left alone', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true });
    fs.writeFileSync(claudeJson(home), '{ broken');
    const res = run(pkg, home, ['install'], { mindSet: makeMindSet() });
    assert.equal(res.code, 1);
    assert.match(res.stdout, /is not valid JSON/);
    assert.equal(fs.readFileSync(claudeJson(home), 'utf8'), '{ broken');
  });

  test('--no-mcp registers nothing; --dry-run writes nothing', () => {
    const { home } = installBoth(['--no-mcp']);
    assert.ok(!exists(claudeJson(home)));
    assert.ok(!exists(codexToml(home)));
    assert.ok(!exists(serverOf(home)));
    const dry = installBoth(['--dry-run']);
    assert.equal(dry.res.code, 0, dry.res.stdout);
    assert.match(dry.res.stdout, /would register MCP server "genesis" for Claude Code/);
    assert.ok(!exists(claudeJson(dry.home)) && !exists(serverOf(dry.home)));
  });

  test('uninstall removes the registrations and the server, and nothing else', () => {
    const pkg = makePackage();
    const home = makeHome({ claude: true, codex: true });
    fs.writeFileSync(claudeJson(home), JSON.stringify({ keep: true, mcpServers: { other: { command: 'x' } } }));
    fs.writeFileSync(codexToml(home), 'model = "gpt-x"\n');
    assert.equal(run(pkg, home, ['install'], { mindSet: makeMindSet() }).code, 0);
    const un = run(pkg, home, ['uninstall']);
    assert.equal(un.code, 0, un.stdout + un.stderr);
    assert.deepEqual(readJson(claudeJson(home)), { keep: true, mcpServers: { other: { command: 'x' } } });
    assert.equal(fs.readFileSync(codexToml(home), 'utf8').trim(), 'model = "gpt-x"');
    assert.ok(!exists(path.join(home, '.genesis-set')));
  });
});

describe('genesis config', () => {
  const cfgFile = (home) => path.join(home, '.genesis-set', 'config.json');
  const runIn = (pkg, home, args, input) =>
    spawnSync(process.execPath, [path.join(pkg, 'bin', 'genesis-set.mjs'), ...args], {
      input,
      encoding: 'utf8',
      env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH },
    });

  test('set-key reads stdin, writes a 0600 file in the home folder and never prints the key', () => {
    const pkg = makePackage();
    const home = makeHome();
    const set = runIn(pkg, home, ['config', 'set-key'], 'fake-key-bbbb\n');
    assert.equal(set.status, 0, set.stderr);
    assert.equal(readJson(cfgFile(home)).apiKey, 'fake-key-bbbb');
    if (process.platform !== 'win32') assert.equal(fs.statSync(cfgFile(home)).mode & 0o777, 0o600);
    const show = runIn(pkg, home, ['config']);
    assert.equal(show.status, 0);
    assert.match(show.stdout, /API key: set \(from .*config\.json\)/);
    for (const out of [set.stdout + set.stderr, show.stdout + show.stderr]) assert.ok(!out.includes('fake-key-bbbb'));
    const doc = run(pkg, home, ['doctor']);
    assert.ok(!doc.stdout.includes('fake-key-bbbb'));
    assert.match(doc.stdout, /Genesis Compiler API key: set \(from .*config\.json\)/);
    assert.equal(runIn(pkg, home, ['config', 'unset-key']).status, 0);
    assert.equal(readJson(cfgFile(home)).apiKey, undefined);
  });

  test('set-key with empty input changes nothing; the key is never taken from the command line', () => {
    const pkg = makePackage();
    const home = makeHome();
    assert.equal(runIn(pkg, home, ['config', 'set-key'], '\n').status, 1);
    assert.ok(!exists(cfgFile(home)));
  });

  test('set-base checks the URL; a plain-http remote base is refused', () => {
    const pkg = makePackage();
    const home = makeHome();
    assert.equal(runIn(pkg, home, ['config', 'set-base', 'http://api.example.com']).status, 2);
    assert.equal(runIn(pkg, home, ['config', 'set-base', 'https://staging.example.com/genesis/compiler/v1']).status, 0);
    assert.equal(readJson(cfgFile(home)).apiBase, 'https://staging.example.com');
    assert.equal(runIn(pkg, home, ['config', 'set-base', 'default']).status, 0);
    assert.equal(readJson(cfgFile(home)).apiBase, undefined);
  });

  test('uninstall keeps the key file and says so', () => {
    const { pkg, home } = installBoth();
    runIn(pkg, home, ['config', 'set-key'], 'fake-key-bbbb\n');
    const un = run(pkg, home, ['uninstall']);
    assert.equal(un.code, 0);
    assert.match(un.stdout, /API key file .* is kept/);
    assert.ok(exists(cfgFile(home)));
  });
});
