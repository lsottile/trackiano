# Review Ledger

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| R1-001 | risk | `src/db.js` | CRITICAL | verified | Verified TLS now requires a trusted CA and `rejectUnauthorized: true`; focused tests and a live Supabase pooler query passed. |
| R4-001 | resilience | `src/db.js` | CRITICAL | verified | Pool idle errors have a registered, tested handler. |
| R4-002 | resilience | `src/data-migration.js` | CRITICAL | verified | Identical retries are no-ops and divergent non-empty targets fail before writes. |
| R4-003 | resilience | `README.md` | CRITICAL | verified | Rollback after PostgreSQL writes now requires pause plus reconciliation/export. |
| R4-004 | resilience | `src/postgres.js` | WARNING | info | Concurrent expense confirmations can show a stale daily total although durable totals remain correct. |
| R4-005 | resilience | `src/migrations.js` | WARNING | info | Concurrent migration runners have no advisory lock and one may fail after the other succeeds. |
| R2-001 | readability | `scripts/migrate-notion-data.js`, migration spec | CRITICAL | verified | Dry-run mismatch is explicitly informational; post-apply mismatch still fails transactionally. |
| R2-002 | readability | `src/data-migration.js` | CRITICAL | verified | Existing user preferences are no longer overwritten; retries return before writes. |
| R2-003 | readability | `test/postgres.integration.test.js` | WARNING | info | Integration test assumes a disposable database if `TEST_DATABASE_URL` is globally present. |
| R2-004 | readability | `openspec/` | SUGGESTION | info | Planning budgets were normalized to the approved 2,500-line exception. |
| R3-001 | reliability | `migrations/001_initial.sql`, `src/postgres.js` | WARNING | info | Financial columns do not independently reject every non-finite/invalid input at the repository boundary. |
| R3-002 | reliability | `README.md` | SUGGESTION | info | Claim documentation was corrected to distinguish Notion races from PostgreSQL atomic claims. |
| PC-001 | reliability | `src/data-migration.js` | CRITICAL | verified | Canonical ordered records compare identity and every migrated field; equal aggregates cannot hide divergence. |
| PC-002 | risk | `src/db.js` | CRITICAL | verified | Real pools reject absent/unknown TLS modes; only verified `require` or explicit disposable `disable` is accepted. |

Two review/refutation sweeps completed for severe rows; no BLOCKER or CRITICAL finding remains open.
