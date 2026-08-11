# User Isolation and Security Specification

## Purpose

Protect category inference and learning data across users and security boundaries.

## Requirements

### Requirement: Current-user category authority

Every explicit, learned, inferred, suggested, or manually selected category MUST resolve to a current category owned by the current user. The system MUST use exact stored spelling in expense writes and user-facing output and MUST fail closed on cross-user resolution attempts.

#### Scenario: Cross-user category candidate

- GIVEN a category belongs to another user
- WHEN it appears in explicit input, a learned rule, provider output, resend choices, or recategorization
- THEN the system MUST NOT select, suggest, or write that category

### Requirement: User-scoped learning access

Every learned-rule lookup, insert, replacement, and recategorization operation MUST include the current user's identity. The database MUST enforce same-user category references, and application owner predicates MUST remain effective even when the service connection can bypass row-level security. These requirements are unconditional in the new release; no backend, rollback, update-only, no-op, or best-effort mode MAY omit current-user identity or ownership enforcement.

#### Scenario: Unsupported backend cannot weaken ownership

- GIVEN the new image is configured with an unset or non-PostgreSQL storage backend
- WHEN application startup is attempted
- THEN startup MUST fail before category lookup or recategorization operations are available

#### Scenario: Cross-user fingerprint collision

- GIVEN two users produce the same normalized-description fingerprint
- WHEN either user looks up a learned rule
- THEN the system MUST return only that user's rule

#### Scenario: Cross-user category reference

- GIVEN a rule write attempts to associate one user's fingerprint with another user's category
- WHEN the database validates the write
- THEN it MUST reject the write

#### Scenario: Cross-user recategorization

- GIVEN a user attempts to recategorize another user's expense or select another user's category
- WHEN the repository handles the request
- THEN it MUST change no expense and no learned rule

### Requirement: Database privilege lockdown

The learned-rule table MUST have row-level security enabled and MUST revoke `anon` and `authenticated` privileges consistently with current production tables.

#### Scenario: Restricted role access

- GIVEN access through an `anon` or `authenticated` database role
- WHEN that role attempts direct learned-rule access
- THEN the database MUST deny access under the production privilege policy

### Requirement: Description and fingerprint privacy

The system MUST NOT write plaintext expense descriptions, normalized descriptions, description fingerprints, provider payloads, correction history, tokens, or API credentials to logs. It MUST NOT send learned fingerprints, correction history, or previous descriptions to OpenRouter. It MAY send only the current description, current amount, current category allowlist, and static catalog guidance required for the current inference request.

#### Scenario: Learned rule lookup is observed

- GIVEN a learned-rule lookup succeeds or fails
- WHEN the system emits operational logs
- THEN the logs MUST NOT contain the plaintext description, normalized description, or fingerprint

#### Scenario: Provider request is built

- GIVEN local learning does not select a category
- WHEN the system builds the single current inference request
- THEN it MUST NOT include learned fingerprints, correction history, or previous descriptions

#### Scenario: Provider failure is logged

- GIVEN OpenRouter returns an error or malformed response
- WHEN the failure is logged
- THEN the log MUST NOT contain the provider payload, current plaintext description, fingerprint, token, or API credential
