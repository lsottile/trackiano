import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCategoryGuidance, normalizeCategoryAlias } from '../src/categorySemantics.js';

const aliases = ['Housing', 'Vivienda', 'Hogar', 'Lodging', 'Alojamiento', 'Investments', 'Inversiones', 'Shopping', 'Compras', 'Food', 'Comida', 'Alimentación', 'Transport', 'Transporte', 'Travel', 'Viajes'];

test('normalizes category aliases without changing stored output spelling', () => {
  assert.equal(normalizeCategoryAlias('  ＶＩＶＩＥＮＤＡ\t'), 'vivienda');
  const guidance = buildCategoryGuidance([{ id: 'x', name: '  Vivienda  ' }]);
  assert.equal(guidance[0].name, '  Vivienda  ');
  assert.match(guidance[0].semantics, /permanent home|hogar permanente/i);
});

test('provides bilingual static guidance for every specified alias family', () => {
  const guidance = buildCategoryGuidance(aliases.map((name) => ({ name })));
  assert.equal(guidance.length, aliases.length);
  assert.ok(guidance.every((entry) => entry.semantics.includes('English:') && entry.semantics.includes('Español:')));
  assert.ok(guidance.every((entry) => entry.examples.length >= 2));
});

test('distinguishes housing/lodging and investments/shopping boundaries', () => {
  const [housing, lodging, investments, shopping] = buildCategoryGuidance(
    ['Housing', 'Lodging', 'Investments', 'Shopping'].map((name) => ({ name })),
  );
  assert.match(housing.semantics, /permanent home/i);
  assert.match(lodging.semantics, /temporary stay/i);
  assert.match(investments.semantics, /financial asset/i);
  assert.match(shopping.semantics, /goods/i);
});

test('unknown categories use exact name-only fallback and absent categories are not emitted', () => {
  assert.deepEqual(buildCategoryGuidance([{ name: 'Mascotas VIP' }]), [{ name: 'Mascotas VIP' }]);
});
