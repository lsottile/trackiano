# Low-Confidence Resend Choices Specification

## Purpose

Make low-confidence inference actionable without creating pending or premature expenses.

## Requirements

### Requirement: No write on low confidence

When the top valid inferred candidate is below the existing auto-accept threshold, the system MUST create no expense and MUST NOT create a pending expense draft.

#### Scenario: Valid candidates below threshold

- GIVEN inference returns one or more valid candidates
- AND the top valid confidence is below `0.7`
- WHEN the bot handles the result
- THEN it MUST perform no expense write
- AND it MUST perform no pending-draft write

### Requirement: Safe complete resend examples

For low-confidence inference, the system MUST construct a small set of two or three validated, deduplicated, currently owned category choices when that many valid candidates are available. Each choice MUST be a complete resend example containing the original expense input needed for creation and the candidate's exact stored category name, including the complete multi-word name when applicable. The system MUST NOT show invented, stale, deleted, cross-user, duplicate, or otherwise invalid categories. It MUST send the constructed choice reply only when its Node.js string `.length` is at most `4096` UTF-16 code units.

#### Scenario: Multi-word candidate choice

- GIVEN `Travel and Lodging` is a validated current category candidate
- WHEN the bot returns a low-confidence response
- THEN it MUST show a complete message the user can resend with `Travel and Lodging` after the amount
- AND it MUST NOT truncate the category to one token

#### Scenario: Invalid alternatives are present in provider output

- GIVEN provider output includes invented, duplicate, stale, or cross-user category names
- WHEN the bot builds low-confidence resend choices
- THEN it MUST exclude those names
- AND every displayed category MUST resolve to a validated current category owned by the user

#### Scenario: Reply is exactly at the Telegram limit

- GIVEN two or three complete validated resend choices produce a final reply whose JavaScript `.length` is exactly `4096`
- WHEN the bot handles the low-confidence result on Node.js 22
- THEN it MUST send the complete reply without truncation

#### Scenario: Reply exceeds the Telegram limit

- GIVEN the fully constructed choice reply has a JavaScript `.length` of `4097` or greater
- WHEN the bot handles the low-confidence result on Node.js 22
- THEN it MUST create no expense
- AND it MUST return the deterministic constant generic safe response whose length is below `4096`
- AND it MUST NOT truncate the input, category names, or individual choices

#### Scenario: Fewer than two valid candidates

- GIVEN fewer than two valid candidates remain after validation
- WHEN the bot handles the low-confidence result
- THEN it MUST create no expense
- AND it MUST return the same deterministic generic safe response without fabricating additional choices

### Requirement: No one-tap choice state

The system MUST NOT offer low-confidence one-tap category callbacks unless durable pending-expense state is introduced by a separate change.

#### Scenario: Low-confidence response

- GIVEN an inference result is below the auto-accept threshold
- WHEN the bot responds
- THEN it MUST use resend guidance rather than a callback that creates the expense from transient state
