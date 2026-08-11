# Provider Resilience Specification

## Purpose

Bound provider usage and fail safely on timeout, failure, or invalid output.

## Requirements

### Requirement: Node.js 22 runtime contract

The new release MUST run on Node.js 22.x. Its bounded timeout behavior MUST use the Node.js 22 `AbortSignal.timeout` contract, and its NFKC normalization, ECMAScript whitespace/lowercase processing, and Telegram-length calculation MUST be tested and documented against that runtime. The application MUST fail startup on another Node major.

#### Scenario: Supported runtime

- GIVEN the application runs on Node.js 22.x
- WHEN timeout and Unicode-dependent category behavior execute
- THEN the system MUST use the documented Node.js 22 behavior

#### Scenario: Unsupported runtime

- GIVEN the application runs on a Node major other than 22
- WHEN application preflight executes
- THEN startup MUST fail before provider or storage side effects

### Requirement: At most one bounded provider request

Each inference attempt that is not resolved by an explicit category or valid learned rule MUST make no more than one OpenRouter request and MUST enforce a bounded timeout. The system MUST NOT retry in a way that exceeds one request for that attempt.

#### Scenario: Provider responds in time

- GIVEN local category selection did not resolve the expense
- WHEN OpenRouter returns within the timeout
- THEN the system MUST have made at most one provider request

#### Scenario: Provider times out

- GIVEN OpenRouter does not complete within the bounded timeout
- WHEN the timeout expires
- THEN the system MUST terminate the inference attempt without a retry
- AND it MUST create no expense

### Requirement: Safe failure response

On provider failure, timeout, malformed model output, or absence of valid candidates, the system MUST create no expense and MUST return the safe resend rejection behavior. It MUST NOT invent choices from invalid provider output.

#### Scenario: Provider transport failure

- GIVEN the provider request fails
- WHEN the bot handles the failure
- THEN it MUST create no expense
- AND it MUST return a safe resend response

#### Scenario: Malformed model output

- GIVEN the provider response cannot produce any structurally valid, finite, allowlisted candidate
- WHEN the system validates the response
- THEN it MUST create no expense
- AND it MUST return a safe resend response

#### Scenario: No valid candidates remain

- GIVEN all returned candidates are invalid, invented, or stale
- WHEN validation completes
- THEN the system MUST treat the result as a provider inference failure
- AND it MUST create no expense

### Requirement: Safe operational failure reporting

Provider, learned lookup, expense write, and correction failures MUST be reportable through an injected seam using only coarse `operation` and `outcome` enums. Reports MUST contain no description, fingerprint, provider data, tokens, IDs, category names, reasons, amount, or `Error`; reporter failure MUST NOT change the generic user-safe response.
