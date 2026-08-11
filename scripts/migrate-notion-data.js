import 'dotenv/config';
import { Client } from '@notionhq/client';
import { createDatabase } from '../src/db.js';
import {
  createPostgresMigrationTarget,
  migrateNotionData,
} from '../src/data-migration.js';
import { exportNotionData } from '../src/notion-export.js';

const allowedArgs = new Set(['--apply']);
const unknownArgs = process.argv.slice(2).filter((arg) => !allowedArgs.has(arg));
if (unknownArgs.length) throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);

const required = [
  'NOTION_TOKEN',
  'NOTION_EXPENSES_DB_ID',
  'NOTION_BUDGETS_DB_ID',
  'NOTION_SETTINGS_DB_ID',
  'DATABASE_URL',
  'TELEGRAM_OWNER_ID',
];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required.`);
}
const telegramUserId = Number(process.env.TELEGRAM_OWNER_ID);
if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
  throw new Error('TELEGRAM_OWNER_ID must be a positive safe integer.');
}

const apply = process.argv.includes('--apply');
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const database = createDatabase();

try {
  const sourceData = await exportNotionData(notion, {
    budgetsDatabaseId: process.env.NOTION_BUDGETS_DB_ID,
    expensesDatabaseId: process.env.NOTION_EXPENSES_DB_ID,
    settingsDatabaseId: process.env.NOTION_SETTINGS_DB_ID,
  });
  const result = await migrateNotionData({
    sourceData,
    target: createPostgresMigrationTarget(database),
    telegramUserId,
    apply,
    userDefaults: {
      language: process.env.APP_LANGUAGE ?? 'es',
      currency: process.env.APP_CURRENCY ?? 'USD',
      timezone: process.env.APP_TIMEZONE ?? 'UTC',
      paydayDay: Number(process.env.PAY_DATE_DAY ?? 31),
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (!apply) console.log('Dry-run only. Re-run with --apply after reviewing reconciliation.');
} finally {
  await database.close();
}
