# Notion Data Migration Specification

## Requirements
### Requirement: Dry-run by default
The utility MUST perform no PostgreSQL mutation unless `--apply` is supplied.
#### Scenario: Run without apply
- GIVEN valid source and target configuration
- WHEN migration runs without `--apply`
- THEN it MUST validate and reconcile without inserting, updating, or deleting records
### Requirement: Complete paginated export
The utility MUST read every Notion budget, expense, and settings page exactly once.
#### Scenario: Multiple result pages
- GIVEN Notion returns a continuation cursor
- WHEN export runs
- THEN it MUST continue until `has_more` is false
### Requirement: Source validation
Before writing, the utility MUST reject malformed IDs, missing budget relations, invalid dates, non-finite money, duplicate per-user budget names, and expenses referencing unknown budgets.
#### Scenario: Unknown budget
- GIVEN an expense relation does not match an exported budget
- WHEN validation runs
- THEN migration MUST fail with the expense ID and MUST NOT write PostgreSQL
### Requirement: Idempotent import
Repeated application of the same valid export MUST converge without duplication.
#### Scenario: Retry a successful import
- GIVEN the source was imported
- WHEN the same source runs again with `--apply`
- THEN all records MUST remain unchanged and no writes MUST occur
### Requirement: Preserve identity and values
Migration MUST preserve budget and expense Notion UUIDs, names/descriptions, cent-rounded amounts, local dates, budget relationships, daily target, and notification claims.
#### Scenario: Existing Telegram callback
- GIVEN a callback contains an imported expense UUID
- WHEN PostgreSQL becomes active
- THEN it MUST identify the same expense
### Requirement: Transactional apply
Apply MUST use one PostgreSQL transaction and roll back every imported change on validation, persistence, or reconciliation failure.
#### Scenario: Expense import fails
- GIVEN budgets were inserted before an expense write fails
- WHEN the transaction aborts
- THEN no partial user, budget, expense, or settings import MUST remain
### Requirement: Exact deterministic reconciliation
The utility MUST compare canonical, deterministically ordered budgets and expenses by identity and every migrated field, plus settings. Operator summaries MUST remain concise and include counts and cent totals.
#### Scenario: Equal aggregates but divergent records
- GIVEN source and target have equal counts and totals but different IDs or fields
- WHEN reconciliation runs
- THEN they MUST NOT match and apply MUST reject a non-empty divergent target
#### Scenario: Equal records in different order
- GIVEN source and target contain identical records in different orders
- WHEN reconciliation runs
- THEN they MUST match and retry MUST perform no writes
#### Scenario: Dry-run mismatch
- GIVEN target differs from source
- WHEN dry-run runs
- THEN it MUST report mismatched measures or record groups without failing merely because import is pending
#### Scenario: Post-import mismatch
- GIVEN target differs after an apply attempt
- WHEN in-transaction reconciliation runs
- THEN it MUST identify concise mismatches and roll back
### Requirement: Explicit remote execution
Scripts and docs MUST NOT automatically provision Railway, change production variables, mutate Notion, or contact remote services during normal tests.
#### Scenario: Normal tests
- GIVEN a developer runs `npm test`
- WHEN tests complete
- THEN no remote Notion, Railway, or PostgreSQL service MUST have been contacted
