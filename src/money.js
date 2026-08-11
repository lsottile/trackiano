export function roundMoney(value) {
  const offset = Math.sign(value) * Number.EPSILON;
  return Math.round((value + offset) * 100) / 100;
}

export function formatMoney(value) {
  return roundMoney(value).toFixed(2);
}
