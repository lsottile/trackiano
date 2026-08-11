# Tasks: Migrate Notion Persistence to PostgreSQL

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2,400–2,500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | User-approved single PR covering schema → repository → migration → docs |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

The user explicitly selected one PR and a 2,500 changed-line review budget. A full risk/resilience/readability/reliability review is required before delivery.

## Task 1: Establish PostgreSQL schema and database boundary

- [x] RED: Add tests under `test/db.test.js` and an opt-in PostgreSQL integration target covering migration ordering, transaction rollback, cent precision, cross-user FK rejection, and migration idempotency.
- [x] GREEN: Add `pg`, `migrations/001_initial.sql`, `src/db.js`, and `scripts/migrate-db.js` with parameterized migration tracking and safe transaction handling.
- [x] TRIANGULATE: Exercise repeated migration runs and failed-transaction cleanup without contacting remote services.
- [x] REFACTOR: Keep pool/client lifecycle centralized and document the local `TEST_DATABASE_URL` command.

## Task 2: Implement the user-scoped PostgreSQL repository

- [x] RED: Add `test/postgres.test.js` scenarios for owner resolution, missing owner failure, budget lookup/list/create, expense create/read/totals, half-open ranges, exact category change, soft deletion, settings initialization, target updates, and atomic claim outcomes.
- [x] GREEN: Add `src/postgres.js` repository factory and production binding using `TELEGRAM_OWNER_ID`, parameterized SQL, UUID IDs, app-local dates, and numeric mapping.
- [x] TRIANGULATE: Add two-user cases proving every read/write is scoped and cross-user expense/category operations fail closed.
- [x] REFACTOR: Extract repeated row/money/date mapping while preserving the existing JavaScript persistence contract.

## Task 3: Introduce backend selection without changing bot behavior

- [x] RED: Add `test/storage.test.js` for safe default, explicit PostgreSQL selection, and rejection of unknown backends; update affected module tests to prove persistence remains injectable.
- [x] GREEN: Add `src/storage.js`; change `src/bot.js`, `src/target.js`, and `src/notifications.js` to import the storage facade instead of `src/notion.js`.
- [x] TRIANGULATE: Run the complete suite once with the Notion default and focused repository tests with PostgreSQL selected and injected dependencies.
- [x] REFACTOR: Keep backend selection at one composition boundary and ensure no bot/notification module imports `pg` or uses SQL.

## Task 4: Build safe Notion export and PostgreSQL import

- [x] RED: Add `test/notion-export.test.js` for complete pagination, UUID normalization, relationship validation, malformed money/date rejection, and page-specific errors.
- [x] GREEN: Add `src/notion-export.js` to read budgets, expenses, and settings without mutating Notion.
- [x] RED: Add `test/data-migration.test.js` proving dry-run performs zero writes, apply is transactional, retries are idempotent, failures roll back, and reconciliation catches count/cent/settings mismatches.
- [x] GREEN: Add `src/data-migration.js` and `scripts/migrate-notion-data.js` with dry-run default and explicit `--apply`.
- [x] TRIANGULATE: Cover empty databases, duplicate names, missing relations, existing target records, and a retry after a simulated partial external failure.
- [x] REFACTOR: Separate extraction, validation, import, and reconciliation so production execution remains auditable.

## Task 5: Document configuration, cutover, and rollback

- [x] RED: Add lightweight documentation assertions where practical for required environment keys and safe defaults.
- [x] GREEN: Update `package.json` scripts and `README.md` for `DATABASE_URL`, `STORAGE_BACKEND`, schema migration, dry-run/apply, reconciliation, pause/cutover, and rollback.
- [x] TRIANGULATE: Verify normal tests never contact Notion, Railway, or a remote PostgreSQL database.
- [x] REFACTOR: Clearly separate local development, migration-only Notion credentials, and production runtime settings.

## Task 6: Verify the complete change

- [x] Run `npm test` and record RED/GREEN/TRIANGULATE/REFACTOR evidence in `apply-progress.md`.
- [x] Run `git diff --check`, dependency audit, and the opt-in local PostgreSQL integration test when a free local database is available.
- [x] Confirm the diff contains no Takenos tables, merchant mappings, pending ingestions, or ingest-ID behavior.
- [x] Run full 4R review because the forecast exceeds 400 changed lines; resolve confirmed critical findings.
- [x] Write `verify-report.md` with test results, migration safety evidence, unresolved risks, and explicit remote steps that were not executed.
- [x] Obtain separate approval before production Notion import, Railway cutover, commit, push, and PR; all were explicitly approved before execution.
