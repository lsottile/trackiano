# Trackiano

Telegram expense bot running on Node.js 22 with PostgreSQL storage. `src/notion.js` is retained unchanged only for historical migration and pre-feature rollback tooling; the current application does not support Notion as a runtime backend.

## Usage

Send a message with the format:
```
{description} {amount}
{description} {amount} {category}
{description} {amount} | {category}
```
Examples: `coffee 50`, `hotel 50 Travel and Lodging`, `snack 5 | Category 2`.
Amounts use finite decimal syntax only; comma decimals, hexadecimal, binary, and exponent forms are rejected. Use the literal `|` delimiter for numeric-suffixed categories or whenever an explicit boundary is clearer. Ambiguous undelimited numeric suffixes fail closed.

When category is omitted, the bot normalizes the current description with NFKC, trims/collapses whitespace, lowercases it, and hashes it with SHA-256. A same-user learned correction is checked locally first. Fingerprints are pseudonymous and are never logged or sent as history. On a miss, one OpenRouter request uses current description/amount, the current PostgreSQL category allowlist, and static bilingual guidance, with an 8-second maximum and no retry. Low-confidence results write nothing and return complete resend examples only when the reply is at most 4,096 JavaScript UTF-16 units; otherwise they use a generic safe response.

## Commands

**Queries**
- `/budget <category>` — daily allowance based on remaining balance and days until payday
- `/budget <category> detail` — list all expenses for the current pay period
- `/balance <category>` — remaining balance for a category
- `/summary` — monthly expenses by category
- `/summary-complete` — monthly summary with the two largest expenses in each category
- `/target` — show the recurring global daily spending target
- `/target <amount>` — set a positive recurring global daily spending target
- `/categories` — list all available categories

**Management**
- `/new <name> <amount>` — create a new budget category
- `/help` — show all available commands

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_TOKEN` | ✓ | Telegram bot token (also used by the Takenos ingestion service to prompt the owner) |
| `TELEGRAM_OWNER_ID` | ✓ | Your Telegram user ID (only you can use the bot; also the ingestion prompt recipient) |
| `STORAGE_BACKEND` | ✓ | Must be the exact value `postgres`; unset, case variants, and `notion` fail startup |
| `DATABASE_URL` | PostgreSQL | PostgreSQL connection string |
| `PGSSLMODE` | PostgreSQL | `require` with a trusted root, or `disable` only for disposable local/test databases |
| `PGSSLROOTCERT` | TLS mode `require` | Trusted CA path; Supabase uses `certs/supabase-root-2021.crt` |
| `NOTION_TOKEN` | Notion/migration | Notion integration token |
| `NOTION_EXPENSES_DB_ID` | Migration only | Historical Notion expenses database ID |
| `NOTION_BUDGETS_DB_ID` | Migration only | Historical Notion budgets database ID |
| `NOTION_SETTINGS_DB_ID` | Migration only | Historical Notion settings database ID |
| `OPENROUTER_API_KEY` | For inferred categories | OpenRouter API key used when the expense category is omitted |
| `OPENROUTER_MODEL` | — | OpenRouter model for category inference, defaults to `google/gemini-2.5-flash` |
| `APP_LANGUAGE` | — | User language stored during migration, defaults to `es` |
| `APP_CURRENCY` | — | ISO currency stored during migration, defaults to `USD` |
| `APP_TIMEZONE` | — | Timezone used for expense dates and daily totals, defaults to `UTC` |
| `PAY_DATE_DAY` | — | Day of month for payday (defaults to last day of month) |
| `INGEST_TOKEN` | Takenos ingestion | Bearer token required by the ingestion HTTP endpoint |
| `TAKENOS_ANDROID_PACKAGE` | Takenos ingestion | Android package name accepted as the Takenos notification source |
| `PORT` | — | HTTP port for the ingestion server, defaults to `3000` |

## Setup

Node.js **22.x** is required (`>=22 <23`). Both bot and notification entrypoints fail preflight before PostgreSQL construction, provider traffic, scheduling, or polling when the runtime/backend contract is not met.

```bash
npm ci
cp .env.example .env
# set STORAGE_BACKEND=postgres and fill in the required variables
npm start
```

## Deploy

The long-running bot and automatic summaries use separate Railway services:

- Bot service: run `npm start` continuously.
- Notification service: run `npm run notifications` as a Railway cron service.
- Schedule the notification service periodically in UTC; every 15 minutes is recommended. The command checks calendar periods in `APP_TIMEZONE` and exits after each run.
- Takenos ingestion service: run `node src/ingest.js` as a separate process. It exposes `POST /ingest/takenos` and requires public HTTP reachability from the device posting notifications, plus `INGEST_TOKEN` and `TAKENOS_ANDROID_PACKAGE`. It also needs `TELEGRAM_TOKEN` and `TELEGRAM_OWNER_ID` to deliver the merchant-selection prompt, and runs the same runtime preflight as the bot (`STORAGE_BACKEND`, `DATABASE_URL`, `PGSSLMODE`). Unknown merchants are persisted first and the owner is prompted in Telegram to pick a category; future purchases from a mapped merchant create expenses directly.

### Historical Notion rollback setup

The pre-feature rollback image requires a dedicated settings database shared with
the historical Notion integration. This is not a runtime setup path for the new
PostgreSQL-only image. Its properties are:

| Property | Type |
|----------|------|
| `Name` | Title |
| `Daily target` | Number |
| `Attempted weekly period` | Text |
| `Attempted monthly period` | Text |

Do not use the budgets database for settings. Trackiano creates and initializes
the singleton with the latest already-closed weekly and monthly periods claimed,
preventing retroactive notifications. If a singleton row already exists with one
or both attempted-period values blank, Trackiano safely initializes only the
blank values without changing the daily target or an existing claim. `/target 70`
then means `$70` per day until changed.

Weekly notifications cover the previous closed Monday-Sunday and compare total
spend with `7 × Daily target`. Monthly notifications cover the previous closed
calendar month and compare total spend with `days in month × Daily target`. If
Monday is also the first day of a month, both summaries are processed
independently.

Delivery uses a durable PostgreSQL claim before calling Telegram. Repeated runs
and restarts do not resend a claimed period, and one conditional atomic update
allows only one concurrent worker to claim it. A Telegram failure after the claim
leaves the notification unsent and it is not retried. Run exactly one Railway cron
service, keep executions non-overlapping, and do not invoke notifications manually
while the cron can be active.

Railway and Notion setup is intentionally manual and must be performed only with
explicit approval; normal tests do not mutate either remote environment.

## PostgreSQL migration

PostgreSQL support is multi-user-ready but the current bot still binds every operation
to `TELEGRAM_OWNER_ID`. Takenos ingestion is part of this schema: migration
`004_takenos_ingestion.sql` adds the expense `ingest_id` idempotency key plus the
`merchant_mappings` and `pending_ingestions` tables. Money uses `NUMERIC(12,2)`,
expense dates remain local calendar dates, and deleted expenses are retained with a
soft-delete timestamp.

Deploy migration-first: apply versioned schema migrations only after configuring an approved database and confirming backup/rollback readiness and migration-runner exclusivity. Migration `003_category_inference_rules.sql` is additive, performs no backfill, and retains learned rules independently of source expenses. Normal `npm test` skips the opt-in PostgreSQL integration scenario; `npm run test:postgres` fails unless `TEST_DATABASE_URL` is explicitly set.

```bash
DATABASE_URL=postgres://... PGSSLMODE=require \
PGSSLROOTCERT=certs/supabase-root-2021.crt npm run db:migrate
```

The Notion migration reads every paginated budget, expense, and settings row,
preserves UUIDs, validates relationships, and reconciles every field plus concise totals.
It is a dry-run unless `--apply` is explicitly supplied:

```bash
npm run migrate:notion
npm run migrate:notion -- --apply
```

Recommended cutover:

1. Restore read access to all three Notion databases.
2. Pause the bot and notification worker so no expense can be written mid-migration.
3. Run PostgreSQL schema migrations, then the Notion dry-run.
4. Correct every validation error before using `--apply`.
5. Require a matching reconciliation report before setting `STORAGE_BACKEND=postgres`.
6. Restart one bot and one notification worker and observe them before resuming normal use.

For this feature, emergency rollback means redeploying the exact pre-feature image/commit. Do not select Notion in the new image, rewrite expenses or categories, or run a reverse migration. Leave `category_inference_rules` and its learned data intact; a later removal requires proving that no deployed version reads or writes it. Production migration, cutover, and rollback are separate operator-confirmed remote actions.

The importer refuses to overwrite a non-empty divergent PostgreSQL target. An identical
retry is a no-op; changed source or target data requires explicit operator resolution.
