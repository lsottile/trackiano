import { roundMoney } from './money.js';

const FORMAT_ERROR = 'Format: {amount} {description} or {description} {amount} [category]';
const INCOME_AMOUNT_ERROR = 'Income amount must round to at least $0.01.';
const DELIMITED_FORMAT = 'Use: {amount} {description} | {category}';
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

function isFiniteDecimal(token) {
  return DECIMAL.test(token) && Number.isFinite(Number(token));
}

export function parseMessage(text) {
  const parts = text.trim().split('|');
  if (parts.length > 2) throw new Error(DELIMITED_FORMAT);
  const tokens = parts[0].trim().split(/\s+/);
  if (tokens.length < 2 || tokens[0] === '') {
    throw new Error(parts.length === 2 ? DELIMITED_FORMAT : FORMAT_ERROR);
  }

  const incomeIndexes = tokens
    .map((token, index) => token.startsWith('+') ? index : -1)
    .filter((index) => index >= 0);
  if (incomeIndexes.length) {
    const index = incomeIndexes[0];
    const amount = Number(tokens[index]);
    const validPosition = index === 0 || index === tokens.length - 1;
    if (
      parts.length !== 1 || incomeIndexes.length !== 1 || !validPosition ||
      !isFiniteDecimal(tokens[index]) || amount <= 0 ||
      tokens.filter(isFiniteDecimal).length !== 1
    ) throw new Error(FORMAT_ERROR);
    if (roundMoney(amount) <= 0) throw new Error(INCOME_AMOUNT_ERROR);
    return {
      description: tokens.filter((_, tokenIndex) => tokenIndex !== index).join(' '),
      amount,
      category: null,
      type: 'income',
    };
  }

  const decimalCount = tokens.filter(isFiniteDecimal).length;
  if (isFiniteDecimal(tokens[0])) {
    if (decimalCount > 1) throw new Error(DELIMITED_FORMAT);
    const description = tokens.slice(1).join(' ');
    if (!description) throw new Error(FORMAT_ERROR);
    if (parts.length === 2) {
      const category = parts[1].trim();
      if (!category) throw new Error(DELIMITED_FORMAT);
      return { description, amount: Number(tokens[0]), category };
    }
    return { description, amount: Number(tokens[0]), category: null };
  }

  let amountTokenIndex = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (isFiniteDecimal(tokens[index])) {
      amountTokenIndex = index;
      break;
    }
  }

  if (amountTokenIndex < 0) {
    const candidate = tokens.length >= 3 ? tokens.at(-2) : tokens.at(-1);
    throw new Error(`"${candidate}" is not a valid amount`);
  }

  const description = tokens.slice(0, amountTokenIndex).join(' ');
  if (!description) throw new Error(FORMAT_ERROR);

  if (parts.length === 2) {
    const category = parts[1].trim();
    if (amountTokenIndex !== tokens.length - 1 || !category) throw new Error(DELIMITED_FORMAT);
    return { description, amount: Number(tokens[amountTokenIndex]), category };
  }

  if (decimalCount > 1) {
    throw new Error(DELIMITED_FORMAT);
  }

  return {
    description,
    amount: Number(tokens[amountTokenIndex]),
    category: tokens.slice(amountTokenIndex + 1).join(' ') || null,
  };
}
