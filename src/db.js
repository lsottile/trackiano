import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

function logPoolError(error) {
  console.error('Unexpected PostgreSQL pool error.', error);
}

function loadRootCertificate(value) {
  if (!value) throw new Error('PGSSLROOTCERT is required when PGSSLMODE=require.');
  return value.includes('BEGIN CERTIFICATE') ? value : readFileSync(value, 'utf8');
}

export function createDatabase({
  connectionString = process.env.DATABASE_URL,
  sslMode = process.env.PGSSLMODE,
  sslRootCert = process.env.PGSSLROOTCERT,
  pool,
  PoolClass = Pool,
  onPoolError = logPoolError,
} = {}) {
  if (!pool && !connectionString) {
    throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  }
  if (!pool && !['require', 'disable'].includes(sslMode)) {
    throw new Error('PGSSLMODE must be explicitly set to "require" or "disable".');
  }
  const activePool = pool ?? new PoolClass({
    connectionString,
    ...(sslMode === 'require'
      ? {
          ssl: {
            rejectUnauthorized: true,
            ca: loadRootCertificate(sslRootCert),
          },
        }
      : {}),
  });
  activePool.on?.('error', onPoolError);

  return {
    query(sql, params) {
      return activePool.query(sql, params);
    },
    async transaction(work) {
      const client = await activePool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query(sql, params) {
            return client.query(sql, params);
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close() {
      return activePool.end();
    },
  };
}
