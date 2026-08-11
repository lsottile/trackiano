# Bilingual Ranked Inference Specification

## Purpose

Define safe ranked category inference for Spanish, English, and mixed-language descriptions.

## Requirements

### Requirement: Bilingual category guidance

The system MUST tell the inference provider that expense descriptions MAY be Spanish, English, or mixed-language. It MUST attach static bilingual semantics and examples only when a current stored category name exactly matches a normalized catalog alias, and MUST represent every other current category by its exact stored name without fabricated semantics. Catalog guidance MUST remain advisory and MUST NOT define, translate, rename, or create categories.

#### Scenario: Known catalog alias

- GIVEN a current stored category exactly matches a normalized static catalog alias
- WHEN inference context is prepared
- THEN the system MUST include that alias's static Spanish and English boundary guidance and examples
- AND it MUST preserve the exact stored category name as the only selectable output

#### Scenario: Arbitrary user category

- GIVEN a current stored category has no exact normalized catalog alias
- WHEN inference context is prepared
- THEN the system MUST include the exact stored name as an eligible category
- AND it MUST NOT fabricate semantics or examples for that category

#### Scenario: Bilingual boundaries

- GIVEN current categories whose known semantics distinguish Housing from Lodging or Investments from Shopping
- WHEN inference context is prepared
- THEN the system MUST provide the applicable static bilingual distinction

### Requirement: Ranked candidate contract

For each non-local inference attempt, the system MUST request an ordered list of no more than three category candidates in the single provider request. Each retained candidate MUST contain a finite numeric confidence from `0` through `1` inclusive, MUST resolve by exact case-insensitive stored-name comparison to a current allowlisted category owned by the user, and MUST be represented thereafter by that category's exact stored spelling. The retained list MUST be deduplicated by resolved stored category and MUST preserve candidate rank.

#### Scenario: Valid ranked candidates

- GIVEN the provider returns up to three ordered candidates with finite confidences in `[0,1]`
- AND each name exactly matches a current allowlisted category case-insensitively
- WHEN the system validates the response
- THEN it MUST retain the candidate order
- AND it MUST expose each category using exact stored spelling

#### Scenario: Invalid confidence

- GIVEN a candidate confidence is `NaN`, infinite, nonnumeric, below `0`, or above `1`
- WHEN the system validates candidates
- THEN it MUST NOT retain that candidate

#### Scenario: Invented candidate

- GIVEN a candidate does not exactly match a current allowlisted category case-insensitively
- WHEN the system validates candidates
- THEN it MUST NOT retain that candidate

#### Scenario: Duplicate candidate

- GIVEN multiple candidates resolve to the same stored category
- WHEN the system validates candidates
- THEN it MUST retain that category at most once
- AND it MUST preserve its earliest valid rank

### Requirement: Compatible auto-acceptance

The system MUST auto-accept only the top valid ranked candidate when its confidence meets the existing `0.7` threshold. It MUST NOT change confidence calibration in this change.

#### Scenario: Top candidate meets threshold

- GIVEN the top valid candidate has confidence `0.7` or greater
- WHEN inference completes
- THEN the system MUST select that candidate using the exact stored category name

#### Scenario: Top candidate is below threshold

- GIVEN at least one valid candidate exists
- AND the top valid candidate has confidence below `0.7`
- WHEN inference completes
- THEN the system MUST NOT auto-create an expense from the inference result
