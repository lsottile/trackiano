# Learned Correction Rules Specification

## Purpose

Define private, deterministic exact-description learning from manual Telegram recategorization.

## Requirements

### Requirement: Deterministic exact-description fingerprint

The system MUST derive the same deterministic fingerprint for descriptions with the same normalized form and MUST distinguish descriptions with different normalized forms. Normalization MUST be documented and deterministic, including trimming, whitespace collapsing, case folding, and defined Unicode and diacritic behavior. The learning store MUST persist the fingerprint rather than a duplicate plaintext normalized description.

#### Scenario: Equivalent normalized descriptions

- GIVEN two descriptions differ only in ways the documented normalization treats as equivalent
- WHEN the system fingerprints both descriptions
- THEN it MUST produce the same fingerprint

#### Scenario: Different normalized descriptions

- GIVEN two descriptions have different normalized forms
- WHEN the system fingerprints both descriptions
- THEN it MUST NOT treat them as the same learned rule

### Requirement: Latest manual correction wins

A learned rule MUST map one user and one normalized-description fingerprint to the latest category manually selected through Telegram recategorization. A later manual correction for that same user and fingerprint MUST replace the prior category. A rule MAY outlive the source expense.

#### Scenario: Repeated correction

- GIVEN a learned rule already maps the user's fingerprint to category `Food`
- WHEN the same user manually recategorizes an expense with that fingerprint to `Shopping`
- THEN the system MUST replace the rule so it maps to `Shopping`

#### Scenario: Source expense later removed

- GIVEN a valid learned rule was created from a manual recategorization
- WHEN the source expense is later removed
- THEN the rule MAY remain available while its referenced category remains valid

### Requirement: Valid local rule precedes provider inference

The system MUST consult the current user's learned rule before calling OpenRouter. If the rule resolves to a current active category owned by that user, the system MUST select that exact stored category without a provider request. A learned match MUST NOT bypass ownership or active-category validation.

#### Scenario: Valid learned hit

- GIVEN the current user has a matching fingerprint rule to a current active category they own
- WHEN the user submits the same normalized description without an explicit category
- THEN the system MUST select the rule's exact stored category
- AND it MUST make no OpenRouter request

#### Scenario: No learned hit

- GIVEN the current user has no matching valid rule
- WHEN the expense requires category inference
- THEN the system MUST continue to normal ranked inference

### Requirement: Stale learned category falls through

If a learned rule references a category that is deleted, inactive, missing, or otherwise no longer valid for the user, the system MUST fail closed and continue through normal inference. It MUST NOT select or suggest the stale category.

#### Scenario: Stale category rule

- GIVEN a matching learned rule references a category that is no longer current and active for the user
- WHEN the rule is consulted
- THEN the system MUST NOT select that category
- AND it MUST continue to normal ranked inference

### Requirement: Additive rule migration

The correction-rule migration MUST be additive, MUST start with no learned rules, MUST require no expense or category backfill, and MUST be safely idempotent under the project's migration execution contract.

#### Scenario: Migration on existing data

- GIVEN existing expenses and categories
- WHEN the correction-rule migration is applied
- THEN it MUST preserve all existing expense and category records
- AND it MUST require no backfill

#### Scenario: Clean database migration order

- GIVEN a disposable clean PostgreSQL database
- WHEN the integration suite runs the migration runner for the first time
- THEN it MUST expect exactly `001_initial.sql`, `002_lock_down_public_schema.sql`, and `003_category_inference_rules.sql` in that order

#### Scenario: Migration execution is repeated

- GIVEN migrations `001`, `002`, and `003` have already been recorded or applied under the project's migration contract
- WHEN migration execution is repeated
- THEN the runner MUST return an empty applied-migration list
- AND it MUST NOT duplicate learning data or alter existing financial records
