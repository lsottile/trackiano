# Transactional Recategorization Specification

## Purpose

Keep manual expense recategorization and learned-rule replacement consistent.

## Requirements

### Requirement: Atomic manual recategorization and learning

Every manual Telegram recategorization in the new release MUST update the exact active expense category and upsert its normalized-description rule in one PostgreSQL repository transaction. Immediately after `BEGIN` and before row locks, it MUST apply fixed local statement and lock timeouts; setup failure MUST roll back and release the client. The transaction MUST use the selected category's exact stored identity and current-user identity and MUST NOT expose SQL through bot code. This contract is unconditional: the new release MUST NOT perform update-only, no-op, best-effort, or non-transactional recategorization under any backend mode.

#### Scenario: Successful recategorization

- GIVEN the user owns the active expense and the selected current category
- WHEN the user confirms manual recategorization
- THEN the system MUST update the expense category
- AND it MUST insert or replace the user's matching learned rule
- AND both changes MUST commit together

#### Scenario: Unsupported backend cannot bypass learning

- GIVEN the new image is configured with an unset or non-PostgreSQL storage backend
- WHEN application startup is attempted
- THEN startup MUST fail
- AND no manual recategorization handler MUST become available

### Requirement: Transactional rollback on any failure

If the expense update or learned-rule persistence fails, the system MUST roll back the entire recategorization transaction so neither change is committed.

#### Scenario: Rule persistence fails

- GIVEN the expense update can be performed
- AND learned-rule persistence fails
- WHEN the transaction completes
- THEN the system MUST roll back the expense category update
- AND it MUST preserve the previously committed rule state

#### Scenario: Expense update fails

- GIVEN learned-rule persistence would otherwise succeed
- AND the target expense cannot be updated
- WHEN the transaction completes
- THEN the system MUST write no learned rule
- AND it MUST leave the expense unchanged

### Requirement: Exact active expense and category validation

The transaction MUST fail closed unless the target expense is the exact active expense owned by the current user and the selected category is a current category owned by the same user.

#### Scenario: Deleted or missing expense

- GIVEN the target expense is missing or deleted
- WHEN recategorization is attempted
- THEN the system MUST update neither the expense nor a learned rule

#### Scenario: Category is no longer current

- GIVEN the selected category is missing, deleted, inactive, or otherwise not current
- WHEN recategorization is attempted
- THEN the system MUST update neither the expense nor a learned rule
