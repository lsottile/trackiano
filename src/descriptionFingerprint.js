import { createHash } from 'node:crypto';

export function normalizeDescription(description) {
  if (typeof description !== 'string') {
    throw new TypeError('Description must be a string.');
  }
  return description.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function fingerprintDescription(description) {
  const normalized = normalizeDescription(description);
  if (!normalized) throw new Error('Description must not be empty.');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
