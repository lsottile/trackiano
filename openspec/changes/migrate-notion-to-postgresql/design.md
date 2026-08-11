# Design: Notion to PostgreSQL Persistence Migration

## Overview

Add PostgreSQL behind a neutral storage facade while retaining Notion for export and pre-write rollback. Runtime remains bound to `TELEGRAM_OWNER_ID`; PostgreSQL records are user-scoped. The user approved a free Supabase project, schema deployment, and reconciled Notion import. Railway still uses Notion pending code deployment and cutover.

## Decisions

- Use `pg` and versioned SQL rather than an ORM.
- Preserve Notion budget/expense UUIDs so Telegram callbacks remain valid.
- Select `notion` or `postgres` with `STORAGE_BACKEND`; default to Notion before cutover and reject unknown values.
- Resolve the configured Telegram owner to one cached PostgreSQL user ID and fail closed when missing.
- Soft-delete expenses and exclude deleted rows from every read.
- Claim notification periods with one conditional atomic update.
- Require verified TLS with the bundled Supabase Root 2021 CA.

## Schema

`users`, `budgets`, `expenses`, and `user_settings` are user-scoped. UUIDs preserve identity; `NUMERIC(12,2)` stores cents; `DATE` preserves local dates; composite foreign keys prevent cross-user budget relations; partial indexes serve active expense queries. RLS and revoked `anon`/`authenticated` grants prevent Supabase Data API exposure. Executable definitions live in `migrations/001_initial.sql` and `002_lock_down_public_schema.sql`.

## Components

- `src/db.js`: pool, verified TLS, pool error handling, and transaction lifecycle.
- `src/postgres.js`: owner-bound repository matching the existing persistence contract.
- `src/storage.js`: one backend composition boundary used by bot, target, and notifications.
- `src/notion-export.js`: complete paginated extraction and validation.
- `src/data-migration.js`: dry-run, guarded transactional import, and reconciliation.
- `scripts/migrate-db.js` / `migrate-notion-data.js`: explicit operator commands.

`pg` numeric strings are converted through `roundMoney(Number(value))`. Bot and notification modules never issue SQL directly.

## Migration Flow

1. Read all Notion budgets, expenses, and settings.
2. Normalize UUIDs, cents, dates, and relationships; fail before writes on invalid source data.
3. Snapshot PostgreSQL and report dry-run differences.
4. Return without writes when target already matches.
5. Reject any non-empty divergent target to prevent stale replay.
6. For an empty target, import owner, budgets, expenses, and settings in one transaction.
7. Reconcile every canonical record field, counts, cent totals, and settings inside that transaction; commit only on equality.

The importer never writes Notion and never resurrects divergent PostgreSQL records.

## Cutover and Rollback

1. Restore Notion read access and pause bot plus notifications.
2. Verify Supabase migrations, run dry-run, resolve validation errors, then apply.
3. Independently verify reconciliation before setting `STORAGE_BACKEND=postgres`.
4. Restart one bot and one notification worker and observe before reopening use.
5. Before PostgreSQL accepts writes, rollback may switch directly to Notion.
6. After any PostgreSQL write, keep services paused until PostgreSQL-only changes are reconciled/exported; never perform a blind backend flip.

## Test Strategy

Strict TDD covers pool/TLS/transactions, repository user scoping and money/date mapping, exact corrections, atomic claims, Notion pagination/validation, dry-run no-write behavior, guarded retries, transactional rollback, and reconciliation. `npm test` uses fakes and contacts no remote service. `npm run test:postgres` runs opt-in constraints/concurrency/import checks against a disposable local PostgreSQL database.

## Risks

- Notion read access is required before import.
- Writer pause is mandatory during cutover.
- Unexpected Notion shapes fail with page identity.
- PostgreSQL rollback after accepted writes requires reconciliation.
- Single-PR size exception is capped at 2,500 changed lines and requires full 4R review.
