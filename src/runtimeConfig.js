export function assertRuntimeAndBackend({
  nodeVersion = process.versions.node,
  storageBackend = process.env.STORAGE_BACKEND,
} = {}) {
  const major = /^(\d+)\./.exec(nodeVersion ?? '')?.[1];
  if (major !== '22') {
    throw new Error('Node.js 22.x is required.');
  }
  if (storageBackend !== 'postgres') {
    throw new Error('STORAGE_BACKEND must be exactly "postgres".');
  }
}

export function assertRuntimeEnvironment(env = process.env) {
  if (!env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
  const ownerId = Number(env.TELEGRAM_OWNER_ID);
  if (!env.TELEGRAM_OWNER_ID?.trim() || !Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new Error('TELEGRAM_OWNER_ID must be a positive safe integer.');
  }
  if (!['require', 'disable'].includes(env.PGSSLMODE)) {
    throw new Error('PGSSLMODE must be exactly "require" or "disable".');
  }
  if (env.PGSSLMODE === 'require' && !env.PGSSLROOTCERT?.trim()) {
    throw new Error('PGSSLROOTCERT is required when PGSSLMODE is "require".');
  }
}
