# Trackiano

Telegram bot that logs expenses to Notion.

## Usage

Send a message with the format:
```
{description} {amount} {category}
```
Example: `coffee 50 food`

## Commands

**Queries**
- `/budget <category>` — daily allowance based on remaining balance and days until payday
- `/budget <category> detalle` — list all expenses for the current pay period
- `/saldo <category>` — remaining balance for a category
- `/resumen` — monthly expenses by category
- `/categorias` — list all available categories

**Management**
- `/nueva <name> <amount>` — create a new budget category in Notion
- `/help` — show all available commands

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_TOKEN` | ✓ | Telegram bot token |
| `TELEGRAM_OWNER_ID` | ✓ | Your Telegram user ID (only you can use the bot) |
| `NOTION_TOKEN` | ✓ | Notion integration token |
| `NOTION_EXPENSES_DB_ID` | ✓ | Notion expenses database ID |
| `NOTION_BUDGETS_DB_ID` | ✓ | Notion budgets database ID |
| `PAY_DATE_DAY` | — | Day of month for payday (defaults to last day of month) |

## Setup

```bash
npm install
cp .env.example .env
# fill in the variables
node src/bot.js
```

## Deploy

Deployed on Railway as a standalone service.
