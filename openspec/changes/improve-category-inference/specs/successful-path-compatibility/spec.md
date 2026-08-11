# Successful-Path Compatibility Specification

## Purpose

Preserve existing financial and Telegram behavior regardless of how a valid category is selected.

## Requirements

### Requirement: Exactly one successful expense write

A successful explicit, learned, or high-confidence inferred category path MUST create exactly one expense and MUST use the exact current stored category owned by the user.

#### Scenario: Explicit category succeeds

- GIVEN an explicit category resolves to a current category owned by the user
- WHEN expense creation succeeds
- THEN the system MUST create exactly one expense

#### Scenario: Learned category succeeds

- GIVEN a valid learned rule selects a current category owned by the user
- WHEN expense creation succeeds
- THEN the system MUST create exactly one expense
- AND the learned lookup MUST change only the category-selection source

#### Scenario: High-confidence inference succeeds

- GIVEN the top valid inferred candidate meets the existing threshold
- WHEN expense creation succeeds
- THEN the system MUST create exactly one expense

### Requirement: Financial precision and local-date compatibility

Successful expenses MUST preserve current cent rounding, amount precision, app-local date assignment, and app-local daily-total calculation behavior.

#### Scenario: Amount requires cent rounding

- GIVEN a successfully categorized expense amount requiring current cent rounding
- WHEN the expense is written and reported
- THEN the system MUST preserve the existing cent-rounding behavior

#### Scenario: Expense near a date boundary

- GIVEN a successfully categorized expense is created near a timezone date boundary
- WHEN its date and daily total are calculated
- THEN the system MUST use the existing app-local date behavior
- AND it MUST preserve the existing daily-total behavior

### Requirement: Telegram response compatibility

Successful expenses MUST preserve the existing confirmation text, inferred-category presentation where applicable, daily total, and exact-expense `Cambiar` and `Eliminar` actions.

#### Scenario: Successful inferred expense

- GIVEN a high-confidence inferred expense is created
- WHEN the bot confirms success
- THEN it MUST preserve the existing inferred-category confirmation behavior
- AND it MUST include the existing daily total
- AND it MUST provide `Cambiar` and `Eliminar` actions for that exact expense

#### Scenario: Successful learned expense

- GIVEN a learned rule selects the category and the expense is created
- WHEN the bot confirms success
- THEN it MUST use the same successful write, reply, total, and action flow as existing successful expenses
