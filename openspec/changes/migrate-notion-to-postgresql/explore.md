# Exploration: Migrate Notion Persistence to PostgreSQL

## Current State

Trackiano runs a single-owner Telegram bot and notification worker on Railway. Both import `src/notion.js`, which stores budgets, expenses, and singleton settings. Notion expense UUIDs are embedded in Telegram correction callbacks.

## Why Change

Notion access is currently broken locally, provides no cross-record transactions or ownership constraints, permits notification-claim races, and is too slow for future interactive analytics. Commercial use requires user isolation.

## Constraints

- Exclude Takenos, Mini App, onboarding, billing, and translation.
- Preserve bot UX, UUIDs, cents, app-timezone dates, and notification semantics.
- Do not import production data or change Railway without approval.
- Deliver one user-approved PR within 2,500 changed lines.

## Direction

Add a neutral storage facade and a user-scoped PostgreSQL repository while retaining Notion temporarily. Default to Notion before cutover. Use UUID keys, `NUMERIC(12,2)`, local `DATE`, composite ownership foreign keys, soft deletion, atomic claims, verified TLS, and Supabase RLS lockdown.

Build a dry-run-first importer that paginates all Notion data, validates before writes, preserves UUIDs, imports an empty target transactionally, reconciles counts/cents/settings, treats an identical retry as a no-op, and rejects divergent targets.

## Alternatives

One-step replacement removes rollback; retaining the `notion.js` name obscures the boundary; SQLite is unsuitable for Railway processes; an ORM is unnecessary for the small query surface.

## Risks

Notion read access, malformed relations, writer pause during cutover, TLS trust, stale replay, and post-write rollback all require explicit safeguards and tests.
