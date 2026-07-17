export function parseMessage(text) {
  const tokens = text.trim().split(/\s+/);

  if (tokens.length < 2 || tokens[0] === '') {
    throw new Error('Format: {description} {amount} [category]');
  }

  const lastTokenAmount = Number(tokens[tokens.length - 1]);
  const hasExplicitCategory = isNaN(lastTokenAmount);
  const amountTokenIndex = hasExplicitCategory
    ? tokens.length - 2
    : tokens.length - 1;
  const amountToken = tokens[amountTokenIndex];
  const amount = Number(amountToken);

  if (isNaN(amount) || amountToken === '') {
    throw new Error(`"${amountToken}" is not a valid amount`);
  }

  const descriptionEndIndex = hasExplicitCategory
    ? tokens.length - 2
    : tokens.length - 1;
  const description = tokens.slice(0, descriptionEndIndex).join(' ');
  if (!description) {
    throw new Error('Format: {description} {amount} [category]');
  }

  const category = hasExplicitCategory ? tokens[tokens.length - 1] : null;

  return { description, amount, category };
}
