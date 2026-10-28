import assert from 'node:assert/strict';
import test from 'node:test';

import { findMerchantFamilyBudget } from '../src/merchantCategoryRules.js';

const budgets = [
  { id: 'coffee', name: 'Coffee & Snacks' },
  { id: 'groceries', name: 'Groceries' },
  { id: 'health', name: 'Health' },
  { id: 'lodging', name: 'Lodging' },
  { id: 'restaurants', name: 'Restaurants' },
  { id: 'subscriptions', name: 'Subscriptions' },
  { id: 'transport', name: 'Transport' },
];

test('maps approved merchant variants to live budget names', () => {
  const cases = [
    ['UBER-PAY', 'transport'],
    ['Cabify Argentina', 'transport'],
    ['TAXI_123', 'transport'],
    ['DiDi * trip', 'transport'],
    ['PEDIDOSYA*FOOD', 'restaurants'],
    ['Rappi restaurant', 'restaurants'],
    ['COFFEE_SHOP', 'coffee'],
    ['Café Martínez', 'coffee'],
    ['Starbucks 152', 'coffee'],
    ['SUPER-MARKET 24', 'groceries'],
    ['Supermercado Central', 'groceries'],
    ['Grocery Store', 'groceries'],
    ['FARMACIA CENTRAL', 'health'],
    ['Farmacity 123', 'health'],
    ['DRUGSTORE NORTE', 'health'],
    ['Hotel Central', 'lodging'],
    ['HOSTEL WORLD', 'lodging'],
    ['AIRBNB * HM42', 'lodging'],
    ['NETFLIX.COM', 'subscriptions'],
    ['SPOTIFY P123', 'subscriptions'],
  ];

  for (const [merchant, expectedBudgetId] of cases) {
    assert.equal(findMerchantFamilyBudget(merchant, budgets)?.id, expectedBudgetId, merchant);
  }
});

test('does not match family words embedded inside unrelated words', () => {
  assert.equal(findMerchantFamilyBudget('MARKETING SERVICES', budgets), null);
  assert.equal(findMerchantFamilyBudget('COFFEETABLE FURNITURE', budgets), null);
  assert.equal(findMerchantFamilyBudget('HOTELERIA SUPPLIES', budgets), null);
  assert.equal(findMerchantFamilyBudget('UBERIZATION LABS', budgets), null);
  assert.equal(findMerchantFamilyBudget('RAPPIDAMENTE STORE', budgets), null);
});

test('returns null when the matched family destination is not a live budget', () => {
  assert.equal(findMerchantFamilyBudget('UBER-PAY', budgets.filter(({ id }) => id !== 'transport')), null);
});

test('returns null for ambiguous or unlisted merchants', () => {
  assert.equal(findMerchantFamilyBudget('COOL HUNTING SRL', budgets), null);
  assert.equal(findMerchantFamilyBudget('', budgets), null);
});
