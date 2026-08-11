# Apply Progress

## Status

Implementation and reconciled production Notion import are complete; Railway deployment and cutover remain pending.

## Strict TDD Evidence

| Slice | RED | GREEN / TRIANGULATE / REFACTOR |
|---|---|---|
| DB boundary | Missing `src/db.js`/`migrations.js`; TLS tests later exposed missing CA enforcement | Transactions, ordered migrations, verified CA, pool errors; 5 focused tests pass |
| PostgreSQL repository | Missing `src/postgres.js` | User-scoped queries, cents/dates, exact correction, atomic claims; unit and real-PostgreSQL tests pass |
| Backend selector | Missing `src/storage.js` | Notion default, explicit PostgreSQL, unknown-value failure; existing bot tests remain green |
| Notion export | Missing `src/notion-export.js` | Full pagination, UUID/date/money/relation validation; 3 focused tests pass |
| Data import | Missing `src/data-migration.js` | Dry-run, transaction, reconciliation, no-op retry, divergent-target rejection, rollback; 6 tests pass |
| Security | Review found unverified TLS and Supabase public-schema exposure | Trusted Supabase CA, RLS, revoked Data API roles, live pooler verification |

## Infrastructure

With explicit approval, created Supabase Free project `trackiano` in São Paulo, applied migrations 001–002, and imported 13 budgets, 260 expenses, and settings with exact reconciliation. Credentials are stored in macOS Keychain; no secret entered Git. Railway was inspected but not reconfigured.

## Delivery

Full 4R and fresh pre-commit risk review completed; every severe finding is verified fixed in `review-ledger.md`.
