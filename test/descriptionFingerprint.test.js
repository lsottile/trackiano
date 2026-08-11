import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fingerprintDescription,
  normalizeDescription,
} from '../src/descriptionFingerprint.js';

test('normalizes NFKC, ECMAScript whitespace, and case in the specified order', () => {
  assert.equal(normalizeDescription('  ＣＡＦÉ\t\n  １２  '), 'café 12');
  assert.equal(normalizeDescription('A\u00a0B\u2003C'), 'a b c');
});

test('preserves diacritics and supports astral text', () => {
  assert.notEqual(normalizeDescription('cafe'), normalizeDescription('café'));
  assert.equal(normalizeDescription('  🚕 TAXI  '), '🚕 taxi');
});

test('rejects non-string and normalized-empty descriptions', () => {
  assert.throws(() => normalizeDescription(null), /must be a string/);
  assert.throws(() => fingerprintDescription('\t\n'), /must not be empty/);
});

test('produces published lowercase SHA-256 vectors', () => {
  assert.equal(
    fingerprintDescription('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('equivalent normalized descriptions share a fingerprint and distinct ones do not', () => {
  assert.equal(fingerprintDescription('  Coffee\tSHOP '), fingerprintDescription('coffee shop'));
  assert.notEqual(fingerprintDescription('cafe'), fingerprintDescription('café'));
});
