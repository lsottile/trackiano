# PostgreSQL Persistence Specification

## Requirements
### Requirement: User-scoped financial data
Every budget, expense, and settings record MUST belong to one user; expenses MUST NOT reference another user's budget.
#### Scenario: Scoped read
- GIVEN two users have data
- WHEN the first user's repository reads
- THEN only the first user's records MUST be returned
#### Scenario: Cross-user relation
- GIVEN a budget belongs to another user
- WHEN an expense references it
- THEN PostgreSQL MUST reject the write
### Requirement: Multi-user-ready single-owner operation
Initial production operation MUST bind bot and notifications to the configured Telegram owner while retaining a multi-user schema.
#### Scenario: Resolve owner
- GIVEN a configured owner ID
- WHEN storage initializes
- THEN exactly one PostgreSQL user MUST be resolved
#### Scenario: Missing owner
- GIVEN no matching owner exists
- WHEN persistence starts
- THEN it MUST fail without accessing another user's data
### Requirement: Cent-precise money
Budgets, expenses, and daily targets MUST persist to two decimals and remain JavaScript numbers at the repository boundary.
#### Scenario: Fractional cents
- GIVEN an amount has more than two decimals
- WHEN persisted
- THEN Trackiano's money rule MUST round it to cents
#### Scenario: PostgreSQL numeric text
- GIVEN `NUMERIC` is returned as text
- WHEN mapped
- THEN consumers MUST receive a cent-rounded number
### Requirement: Preserve local calendar dates
Expense dates MUST remain app-timezone `DATE` values, not UTC instants.
#### Scenario: Previous local day
- GIVEN an instant belongs to the previous app-timezone day
- WHEN an expense is created
- THEN its date MUST be that local day
#### Scenario: Half-open range
- GIVEN expenses lie on both boundaries
- WHEN `[start, end)` is queried
- THEN start MUST be included and end excluded
### Requirement: Exact expense correction
UUIDs MUST be preserved; change and soft-delete operations MUST affect only the selected user's exact expense.
#### Scenario: Change category
- GIVEN an active expense and same-user budget
- WHEN category changes
- THEN only that expense's relation MUST change
#### Scenario: Delete expense
- GIVEN an active expense
- WHEN deleted
- THEN reads and totals MUST exclude it without physical removal
### Requirement: Atomic notification claims
Weekly and monthly claims MUST be atomic so concurrent workers cannot both claim one user-period.
#### Scenario: Concurrent claims
- GIVEN two workers claim the same unclaimed period
- WHEN both run
- THEN exactly one MUST succeed
#### Scenario: Existing claim
- GIVEN a period is claimed
- WHEN claimed again
- THEN the operation MUST return false without changing settings
### Requirement: Explicit PostgreSQL TLS mode
Real pool creation MUST fail closed unless `PGSSLMODE=require` has `PGSSLROOTCERT`, or `PGSSLMODE=disable` is explicitly selected for disposable local/test PostgreSQL. Missing and unknown modes MUST be rejected; injected test pools MAY omit TLS configuration.
#### Scenario: Verified TLS
- GIVEN mode `require` and a trusted root
- WHEN a pool is created
- THEN certificate verification MUST be enabled with that root
#### Scenario: Explicit local disable
- GIVEN disposable local PostgreSQL and mode `disable`
- WHEN a pool is created
- THEN it MAY connect without TLS
#### Scenario: Missing or unknown mode
- GIVEN no injected pool and an unsupported or absent mode
- WHEN database creation runs
- THEN it MUST fail before pool creation
### Requirement: Selectable storage backend
Runtime MUST support explicit `notion` and `postgres`, default safely before cutover, and reject unknown values.
#### Scenario: Pre-cutover default
- GIVEN no backend is set
- WHEN storage initializes
- THEN it MUST use the documented safe default
#### Scenario: Pre-write rollback
- GIVEN verification fails before PostgreSQL accepts writes
- WHEN backend changes to `notion`
- THEN both services MUST use the existing adapter without deployment
#### Scenario: PostgreSQL accepted writes
- GIVEN PostgreSQL has unique writes
- WHEN rollback is considered
- THEN services MUST stay paused until changes are reconciled or exported
### Requirement: No Takenos coupling
Schema migration MUST NOT require Takenos tables, mappings, pending ingestions, or ingest IDs.
#### Scenario: Clean database
- GIVEN clean PostgreSQL
- WHEN migrations run
- THEN schema creation MUST complete without Takenos configuration or data
