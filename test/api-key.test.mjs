// Where a user gets the Genesis API key, and the key step of `genesis-set install` (#9351):
// the portal link in every key message, the hidden prompt on a terminal, the printed link
// without one, and the key never printed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { offerApiKey } from '../lib/config-cli.mjs';
import { PORTAL_KEYS_URL, missingKeyMessage, portalKeysUrl } from '../mcp/config.mjs';
import { cleanup, makeHome, makeMindSet, makePackage, run, tempDir } from './helpers.mjs';

after(cleanup);

const KEY = 'sk_fake_onboarding';
const STAGE_KEYS = 'https://stage.genesiscompiler.com/keys';

function capture() {
  const lines = { out: [], err: [] };
  return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
}

function home() {
  const dir = tempDir();
  return { dir, env: { HOME: dir, USERPROFILE: dir, GENESIS_SET_HOME: path.join(dir, '.genesis-set') } };
}

const configFile = (h) => path.join(h.dir, '.genesis-set', 'config.json');

describe('the portal keys page', () => {
  test('follows the API base: the stage API has the stage portal, every other base the prod one', () => {
    assert.equal(PORTAL_KEYS_URL, 'https://portal.genesiscompiler.com/keys');
    assert.equal(portalKeysUrl(undefined), PORTAL_KEYS_URL);
    assert.equal(portalKeysUrl('https://api.genesiscompiler.com'), PORTAL_KEYS_URL);
    assert.equal(portalKeysUrl('https://sapi.genesiscompiler.com'), STAGE_KEYS);
    assert.equal(portalKeysUrl('http://127.0.0.1:4010'), PORTAL_KEYS_URL);
    assert.equal(portalKeysUrl('not a url'), PORTAL_KEYS_URL);
  });

  test('the missing-key message names the page and keeps the never-in-the-chat rule', () => {
    const m = missingKeyMessage('/x/config.json', 'https://sapi.genesiscompiler.com');
    assert.match(m, /stage\.genesiscompiler\.com\/keys/);
    assert.match(m, /genesis-set config set-key/);
    assert.match(m, /Never put the key in the project folder, the blueprint, a commit or the chat/);
    assert.match(missingKeyMessage('/x/config.json'), /portal\.genesiscompiler\.com\/keys/);
  });
});

describe('the install key step', () => {
  test('on a terminal: a pasted key is stored (0600) and never printed', async () => {
    const h = home();
    const c = capture();
    let asked = 0;
    await offerApiKey({ env: h.env, out: c.out, err: c.err, interactive: true, readSecret: async () => (asked++, `  ${KEY}  `) });
    assert.equal(asked, 1);
    assert.equal(JSON.parse(fs.readFileSync(configFile(h), 'utf8')).apiKey, KEY);
    if (process.platform !== 'win32') assert.equal(fs.statSync(configFile(h)).mode & 0o777, 0o600);
    const printed = c.lines.out.join('\n') + c.lines.err.join('\n');
    assert.match(printed, /portal\.genesiscompiler\.com\/keys/);
    assert.match(printed, /API key stored in/);
    assert.ok(!printed.includes(KEY), 'the key is never printed');
  });

  test('on a terminal: Enter skips, writes nothing and says how to set it later', async () => {
    const h = home();
    const c = capture();
    await offerApiKey({ env: h.env, out: c.out, err: c.err, interactive: true, readSecret: async () => '' });
    assert.ok(!fs.existsSync(configFile(h)));
    assert.match(c.lines.out.join('\n'), /Skipped\. Later: "genesis-set config set-key"/);
  });

  test('a key with whitespace inside is refused without failing the install', async () => {
    const h = home();
    const c = capture();
    await offerApiKey({ env: h.env, out: c.out, err: c.err, interactive: true, readSecret: async () => 'sk_a b' });
    assert.ok(!fs.existsSync(configFile(h)));
    assert.match(c.lines.err.join('\n'), /must not contain whitespace/);
  });

  test('without a terminal: the link and the command, and nothing waits for input', async () => {
    const h = home();
    const c = capture();
    await offerApiKey({ env: h.env, out: c.out, err: c.err, interactive: false, readSecret: async () => assert.fail('must not read') });
    assert.ok(!fs.existsSync(configFile(h)));
    assert.match(c.lines.out.join('\n'), /No Genesis API key yet: the user creates one at https:\/\/portal\.genesiscompiler\.com\/keys/);
  });

  test('a dry run writes no key and asks nothing', async () => {
    const h = home();
    const c = capture();
    await offerApiKey({ env: h.env, out: c.out, err: c.err, dryRun: true, interactive: true, readSecret: async () => assert.fail('must not read') });
    assert.ok(!fs.existsSync(configFile(h)));
    assert.match(c.lines.out.join('\n'), /dry run: no API key asked/);
  });

  test('a key already set is reported by its source, never its value, and not asked again', async () => {
    const h = home();
    const c = capture();
    await offerApiKey({ env: { ...h.env, GENESIS_API_KEY: KEY }, out: c.out, err: c.err, interactive: true, readSecret: async () => assert.fail('must not read') });
    const printed = c.lines.out.join('\n');
    assert.match(printed, /Genesis API key: set \(from GENESIS_API_KEY\)/);
    assert.ok(!printed.includes(KEY));
  });
});

describe('the CLI', () => {
  test('install without a terminal prints the portal link and exits; --no-key skips the step', () => {
    const h = makeHome({ claude: true });
    const res = run(makePackage(), h, ['install'], { mindSet: makeMindSet() });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /No Genesis API key yet: the user creates one at https:\/\/portal\.genesiscompiler\.com\/keys/);
    const quiet = run(makePackage(), makeHome({ claude: true }), ['install', '--no-key'], { mindSet: makeMindSet() });
    assert.equal(quiet.code, 0, quiet.stdout + quiet.stderr);
    assert.doesNotMatch(quiet.stdout, /Genesis API key/);
  });

  test('install and doctor point a stage API base at the stage portal', () => {
    const pkg = makePackage();
    const h = makeHome({ claude: true });
    const env = { GENESIS_API_BASE: 'https://sapi.genesiscompiler.com' };
    const res = run(pkg, h, ['install'], { mindSet: makeMindSet(), env });
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /stage\.genesiscompiler\.com\/keys/);
    const doc = run(pkg, h, ['doctor'], { mindSet: makeMindSet(), env });
    assert.match(doc.stdout, /not set \(GENESIS_API_KEY, or "genesis-set config set-key"; create one at https:\/\/stage\.genesiscompiler\.com\/keys\)/);
  });
});
