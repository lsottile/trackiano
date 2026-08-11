# Proposal: Migrate Notion Persistence to PostgreSQL

## Intent

Replace Notion production persistence with PostgreSQL while preserving current Telegram behavior and preparing for multiple users and a future embedded Telegram Mini App.

## Problem and Outcome

Notion lacks transactional integrity, domain constraints, and efficient analytics; lost integration access also blocks maintenance. After this change, the current owner can use the same bot and summaries through user-isolated, cent-precise PostgreSQL storage with atomic notification claims. Notion remains a temporary migration source and safe pre-write rollback backend.

## Assumptions

The user requested automatic progress, so this proceeds with explicit assumptions: first cutover remains single-owner; USD and existing timezone/payday behavior remain; maintenance-window cutover is acceptable; and production data import requires separate approval.

## Scope

Included:

- versioned PostgreSQL schema and user-scoped repository;
- Notion/PostgreSQL backend selector;
- atomic notification claims;
- dry-run-first, transactional, guarded Notion import with reconciliation;
- tests, environment guidance, cutover, and rollback documentation.

Excluded:

- Takenos and related tables;
- Mini App/API, public onboarding, billing, plans, and translation;
- paid Railway PostgreSQL or removing the rollback adapter.

## Capabilities

- `postgres-persistence`: constrained user-scoped storage for current Trackiano behavior.
- `notion-data-migration`: complete validated transfer with stable UUIDs.
- `storage-backend-selection`: controlled pre-write rollback and cutover.

## Success Criteria

- Existing behavior tests remain green.
- PostgreSQL tests prove user isolation, cents, dates, soft deletion, atomic claims, and RLS lockdown.
- Dry-run writes nothing; identical retries write nothing; divergent targets are rejected.
- Apply is transactional and reconciliation matches counts, cent totals, and settings.
- `STORAGE_BACKEND=notion` retains the old path; no Takenos coupling appears.

## Rollback

Pause writers before import. Before PostgreSQL accepts user writes, rollback may restore Notion immediately. Afterwards, services must remain paused until PostgreSQL-only changes are reconciled/exported; blind fallback to unchanged Notion is forbidden.

## Risks

Notion access must be restored; malformed source data requires correction; writers must remain paused during cutover; and the user approved one PR up to 2,500 changed lines.
