import { getSettings, setDailyTarget } from './notion.js';
import {
  getLatestClosedMonthlyPeriod,
  getLatestClosedWeeklyPeriod,
} from './periods.js';

export function parseTargetAmount(input) {
  const amount = Number(input.trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Target must be a positive number.');
  }
  return amount;
}

export async function handleTargetCommand(
  ctx,
  {
    now = new Date(),
    timeZone = process.env.APP_TIMEZONE ?? 'UTC',
    getSettings: readSettings = getSettings,
    setDailyTarget: persistDailyTarget = setDailyTarget,
  } = {},
) {
  const weeklyPeriod = getLatestClosedWeeklyPeriod({ now, timeZone });
  const monthlyPeriod = getLatestClosedMonthlyPeriod({ now, timeZone });
  const initialPeriodKeys = {
    initialWeeklyPeriodKey: weeklyPeriod.key,
    initialMonthlyPeriodKey: monthlyPeriod.key,
  };
  const input = ctx.match.trim();

  if (!input) {
    const settings = await readSettings(initialPeriodKeys);
    if (settings.dailyTarget === null) {
      return ctx.reply('Daily target is not set. Use /target <amount>.');
    }
    return ctx.reply(`Current daily target: $${settings.dailyTarget}`);
  }

  let dailyTarget;
  try {
    dailyTarget = parseTargetAmount(input);
  } catch (error) {
    return ctx.reply(error.message);
  }

  await persistDailyTarget(dailyTarget, initialPeriodKeys);
  return ctx.reply(`Daily target set to $${dailyTarget}`);
}
