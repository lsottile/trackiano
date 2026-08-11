# Expense Input Parsing Specification

## Purpose

Define backward-compatible expense parsing with explicit multi-word categories.

## Requirements

### Requirement: Rightmost finite numeric amount

The system MUST identify the rightmost token that represents a finite numeric amount as the expense amount and MUST join every following token, in order, as the explicit category name. If no tokens follow that amount, the system MUST treat the category as omitted and continue through category inference.

#### Scenario: Explicit multi-word category

- GIVEN the message `hotel 50 Travel and Lodging`
- WHEN the system parses the message
- THEN it MUST parse `50` as the amount
- AND it MUST parse `Travel and Lodging` as the explicit category
- AND it MUST parse `hotel` as the description

#### Scenario: Number in the description

- GIVEN a message containing one or more numeric tokens before the applicable amount
- WHEN the system parses the message
- THEN it MUST select the rightmost finite numeric token as the amount
- AND it MUST keep earlier numeric tokens in the description

#### Scenario: Omitted category

- GIVEN the message `coffee with milk 50`
- WHEN the system parses the message
- THEN it MUST parse `50` as the amount
- AND it MUST treat the category as omitted

### Requirement: Exact explicit-category resolution

The system MUST resolve an explicit category only by an exact case-insensitive comparison with a current stored category owned by the user, and MUST use the stored category's exact spelling in writes and user-facing output. It MUST NOT use fuzzy matching, translation, alias semantics, or invented names for explicit-category resolution.

#### Scenario: Case-insensitive stored-name match

- GIVEN the user owns a current category named `Travel and Lodging`
- AND the message supplies `travel and lodging` after the amount
- WHEN the system resolves the explicit category
- THEN it MUST select `Travel and Lodging`

#### Scenario: No exact stored-name match

- GIVEN no current category owned by the user exactly matches the supplied category name case-insensitively
- WHEN the system resolves the explicit category
- THEN it MUST NOT select a category by partial, fuzzy, translated, or semantic matching

### Requirement: Explicit decimal and ambiguity boundary

The system MUST accept only finite decimal amount tokens and MUST reject comma decimals, hexadecimal, binary, and exponent forms. An undelimited message whose final numeric token could be a numeric-suffixed category MUST fail closed. The literal syntax `{description} {amount} | {category}` MUST resolve numeric-suffixed and multi-word categories without changing ordinary one-number omission or nonnumeric suffix behavior.

#### Scenario: Numeric-suffixed category

- GIVEN `snack 5 Category 2`
- WHEN parsed without a delimiter
- THEN parsing MUST fail with delimiter guidance
- AND `snack 5 | Category 2` MUST parse amount `5` and category `Category 2`

#### Scenario: Non-decimal numeric notation

- GIVEN an amount token such as `12,50`, `0x10`, `0b10`, or `1e2`
- WHEN the system parses the message
- THEN it MUST reject that token as an amount

#### Scenario: Existing valid form

- GIVEN an input form that produced a successful expense before this change
- WHEN the system parses it after this change
- THEN it MUST preserve that successful interpretation unless it falls within an explicitly unsupported ambiguity
