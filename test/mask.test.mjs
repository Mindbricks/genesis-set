// How a stored key is shown to the user (#9382): its type prefix and its last four
// characters, so test and live keys and two keys of one account can be told apart,
// with at least MASK_HIDDEN_MIN characters always hidden. Agents never get even this.

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { offerApiKey, shownKey } from '../lib/config-cli.mjs';
import { MASK_HIDDEN_MIN, MASK_PREFIX_MAX, maskSecret } from '../mcp/config.mjs';
import { cleanup, makeHome, makeMindSet, makePackage, run, tempDir } from './helpers.mjs';

after(cleanup);

/** Key-shaped test values, assembled so no source line holds one. */
const key = (...parts) => parts.join('_');
const TEST_KEY = key('sk', 'test', `${'a'.repeat(16)}b1b2`);
const LIVE_KEY = key('sk', 'live', `${'a'.repeat(16)}c3c4`);
const MBX_KEY = key('sk', 'mbx', `${'a'.repeat(20)}9f3a`);

describe('maskSecret', () => {
  test('shows the type prefix and the last four characters', () => {
    assert.equal(maskSecret(TEST_KEY), 'sk_test_...b1b2');
    assert.equal(maskSecret(LIVE_KEY), 'sk_live_...c3c4');
    assert.equal(maskSecret(MBX_KEY), 'sk_mbx_...9f3a');
    assert.equal(maskSecret(`whsec-${'a'.repeat(20)}zz99`), 'whsec-...zz99');
    assert.equal(maskSecret(`${'a'.repeat(20)}dddd`), 'aaaa...dddd', 'no marker: the first four characters');
  });

  test('a short value shows nothing of itself', () => {
    for (const v of ['', 'short', key('sk', 'test', 'ab12'), 'a'.repeat(15), undefined, null, 42]) assert.equal(maskSecret(v), null, String(v));
    assert.equal(shownKey('tiny-value'), 'set');
  });

  test('never shows more than the prefix and four characters, and always hides at least eight', () => {
    const samples = [TEST_KEY, LIVE_KEY, MBX_KEY];
    for (let n = 1; n <= 60; n++) {
      samples.push('x'.repeat(n), `ab_${'y'.repeat(n)}`, `abcdefgh-ijklmnop-${'z'.repeat(n)}`, `a_b_c_${'w'.repeat(n)}`);
    }
    for (const v of samples) {
      const m = maskSecret(v);
      if (m === null) continue;
      const [prefix, tail] = m.split('...');
      assert.ok(v.startsWith(prefix) && v.endsWith(tail), m);
      assert.equal(tail.length, 4, m);
      assert.ok(prefix.length <= MASK_PREFIX_MAX, m);
      assert.ok(v.length - prefix.length - tail.length >= MASK_HIDDEN_MIN, `${m} hides too little of a ${v.length}-character value`);
    }
  });
});

describe('where the user sees it', () => {
  test('the install key step and config show print the masked key, never the key', async () => {
    const dir = tempDir();
    const env = { HOME: dir, USERPROFILE: dir, GENESIS_SET_HOME: path.join(dir, '.genesis-set'), GENESIS_API_KEY: MBX_KEY };
    const lines = [];
    await offerApiKey({ env, out: (l) => lines.push(l), err: (l) => lines.push(l), interactive: false });
    assert.match(lines.join('\n'), /Genesis API key: sk_mbx_\.\.\.9f3a \(from GENESIS_API_KEY\)/);
    assert.ok(!lines.join('\n').includes(MBX_KEY));
    const h = makeHome();
    const show = run(makePackage(), h, ['config', 'show'], { mindSet: makeMindSet(), env: { GENESIS_API_KEY: LIVE_KEY } });
    assert.match(show.stdout, /API key: sk_live_\.\.\.c3c4 \(from GENESIS_API_KEY\)/);
    assert.ok(!show.stdout.includes(LIVE_KEY));
  });

  test('doctor prints the masked key in effect', () => {
    const pkg = makePackage();
    const h = makeHome({ claude: true });
    assert.equal(run(pkg, h, ['install', '--no-key'], { mindSet: makeMindSet() }).code, 0);
    const res = run(pkg, h, ['doctor'], { mindSet: makeMindSet(), env: { GENESIS_API_KEY: TEST_KEY } });
    assert.match(res.stdout, /Genesis Compiler API key: sk_test_\.\.\.b1b2 \(from GENESIS_API_KEY\)/);
    assert.ok(!res.stdout.includes(TEST_KEY));
  });
});
