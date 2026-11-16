import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareVersions, satisfies } from '../lib/semver.mjs';

describe('semver', () => {
  test('caret ranges below 1.0 stay inside the minor', () => {
    assert.equal(satisfies('0.1.0', '^0.1.0'), true);
    assert.equal(satisfies('0.1.9', '^0.1.0'), true);
    assert.equal(satisfies('0.2.0', '^0.1.0'), false);
    assert.equal(satisfies('0.0.9', '^0.1.0'), false);
    assert.equal(satisfies('1.4.0', '^1.2.0'), true);
    assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  });

  test('tilde, comparators and alternatives', () => {
    assert.equal(satisfies('0.1.5', '~0.1.2'), true);
    assert.equal(satisfies('0.2.0', '~0.1.2'), false);
    assert.equal(satisfies('0.2.5', '>=0.1.0 <0.3.0'), true);
    assert.equal(satisfies('0.3.0', '>=0.1.0 <0.3.0'), false);
    assert.equal(satisfies('0.5.0', '^0.1.0 || ^0.5.0'), true);
    assert.equal(satisfies('0.1.0', '0.1.0'), true);
  });

  test('a pre-release only matches a range on the same version', () => {
    assert.equal(satisfies('0.2.0-beta.1', '^0.1.0'), false);
    assert.equal(satisfies('0.1.1-rc.1', '>=0.1.1-rc.0 <0.2.0'), true);
    assert.equal(compareVersions('0.1.0-rc.2', '0.1.0-rc.10'), -1);
    assert.equal(compareVersions('0.1.0', '0.1.0-rc.1'), 1);
  });

  test('unreadable input is null, not false', () => {
    assert.equal(satisfies('banana', '^0.1.0'), null);
    assert.equal(satisfies('0.1.0', 'latest'), null);
  });
});
