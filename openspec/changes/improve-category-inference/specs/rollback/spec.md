# Category Inference Rollback Specification

## Purpose

Permit an emergency application rollback without financial-record reversal or learning-data loss.

## Requirements

### Requirement: PostgreSQL-only new-release startup

The new-release application MUST run on Node.js 22.x and MUST fail startup unless `STORAGE_BACKEND` is explicitly equal to `postgres`. It MUST fail before registering handlers or schedulers, starting bot polling, or making storage or provider calls. It MUST NOT offer Notion as a degraded, best-effort, or no-learning mode.

#### Scenario: PostgreSQL is explicitly configured

- GIVEN the application runs on Node.js 22.x
- AND `STORAGE_BACKEND=postgres`
- WHEN the new-release application starts
- THEN startup MAY continue to PostgreSQL initialization

#### Scenario: Backend is unset or not PostgreSQL

- GIVEN `STORAGE_BACKEND` is unset or is any value other than the exact string `postgres`
- WHEN the new-release application starts
- THEN startup MUST fail before application side effects begin
- AND the application MUST NOT silently select Notion or disable learning

#### Scenario: Runtime is not Node.js 22

- GIVEN the application runtime is not Node.js 22.x
- WHEN the new-release application starts
- THEN startup MUST fail before application side effects begin

### Requirement: Pre-feature-image application rollback

Operators MUST restore the prior parser, prompt, low-confidence response, inference, correction, and storage behavior by redeploying the pre-feature application image/commit. Rollback MUST NOT be implemented by selecting Notion in the new image, conditionally disabling learned-rule operations, or adding no-op/best-effort learning APIs. Rollback MUST NOT revert existing expenses and MUST require no reverse data migration.

#### Scenario: Emergency application rollback

- GIVEN the improved category inference feature is deployed
- WHEN operators redeploy the pre-feature application image/commit
- THEN existing expenses MUST remain unchanged
- AND the deployed prior code MUST perform no learned-rule reads or writes
- AND prior parser, inference, correction, low-confidence, and storage behavior MUST be restored
- AND the new image MUST NOT remain deployed in a degraded mode

### Requirement: Preserve the historical Notion adapter without feature APIs

The repository MUST retain its existing Notion adapter for historical rollback and migration code, but this change MUST NOT add learned lookup, transactional-learning, no-op learning, update-only correction fallback, or best-effort feature APIs to that adapter.

#### Scenario: New-release Notion configuration

- GIVEN the new application image is configured with `STORAGE_BACKEND=notion`
- WHEN startup validation runs
- THEN startup MUST fail
- AND no Notion learning compatibility method MUST be invoked

#### Scenario: Historical rollback requires Notion code

- GIVEN operators redeploy a pre-feature image/commit whose established configuration uses the historical adapter
- WHEN rollback starts that prior code
- THEN the unchanged historical adapter MAY be used by that prior code
- AND the new release MUST NOT emulate that rollback inside its own image

### Requirement: Preserve additive learning data

An emergency application rollback MUST NOT drop or clear the additive learning table. The table MAY remain unused, and a later migration MAY remove it only after confirming that no deployed code reads or writes it.

#### Scenario: Application rollback completes

- GIVEN learned rules exist
- WHEN the application rollback completes
- THEN the learning table and its data MUST remain intact and unused

#### Scenario: Later table removal

- GIVEN operators plan a later migration to remove the learning table
- WHEN removal safety is evaluated
- THEN they MUST confirm that no deployed code reads or writes the table before removal

### Requirement: Rollback does not rewrite category data

Because this change adds no backfill and does not alter stored category names or successful expense records, rollback MUST NOT rename categories, rewrite successful expenses, or synthesize reverse-learning data.

#### Scenario: Existing records after rollback

- GIVEN categories, expenses, and learned rules created before rollback
- WHEN rollback is applied
- THEN stored category names and successful expense records MUST remain unchanged
