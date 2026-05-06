export function parseMessage(text) {
  const tokens = text.trim().split(/\s+/);

  if (tokens.length < 3) {
    throw new Error('Format: {description} {amount} {category}');
  }

  const category = tokens[tokens.length - 1];
  const amount = Number(tokens[tokens.length - 2]);

  if (isNaN(amount) || tokens[tokens.length - 2] === '') {
    throw new Error(`"${tokens[tokens.length - 2]}" is not a valid amount`);
  }

  const description = tokens.slice(0, tokens.length - 2).join(' ');

  return { description, amount, category };
}
