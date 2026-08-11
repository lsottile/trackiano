# Takenos Exclusion Specification

## Purpose

Keep Takenos completely outside the category-inference first slice.

## Requirements

### Requirement: No Takenos dependency or data flow

The category-inference, correction-learning, recategorization, migration, and rollback behaviors in this change MUST NOT integrate with, query, mutate, depend on, or send data to Takenos. Learned rules MUST be PostgreSQL-only and MUST derive only from manual Telegram recategorization.

#### Scenario: Category inference attempt

- GIVEN an expense requires category inference
- WHEN the system selects or suggests a category
- THEN it MUST NOT read from or write to Takenos

#### Scenario: Manual recategorization

- GIVEN a user manually recategorizes a Telegram expense
- WHEN the expense and learned rule are updated
- THEN no correction signal or expense data MUST be sent to Takenos

#### Scenario: Learning migration or rollback

- GIVEN the learning migration is applied or the feature is rolled back
- WHEN the operation completes
- THEN it MUST require no Takenos schema, service, secret, or data change
