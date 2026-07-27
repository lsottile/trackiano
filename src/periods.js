const DEFAULT_APP_TIMEZONE = 'UTC';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function formatDateInTimeZone(
  date = new Date(),
  timeZone = process.env.APP_TIMEZONE ?? DEFAULT_APP_TIMEZONE,
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOnlyToDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = dateOnlyToDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

export function getLatestClosedWeeklyPeriod({
  now = new Date(),
  timeZone = process.env.APP_TIMEZONE ?? DEFAULT_APP_TIMEZONE,
} = {}) {
  const today = formatDateInTimeZone(now, timeZone);
  const weekday = dateOnlyToDate(today).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const end = addDays(today, -daysSinceMonday);
  const start = addDays(end, -7);
  return { key: `${start}/${end}`, start, end, days: 7 };
}

export function getLatestClosedMonthlyPeriod({
  now = new Date(),
  timeZone = process.env.APP_TIMEZONE ?? DEFAULT_APP_TIMEZONE,
} = {}) {
  const [year, month] = formatDateInTimeZone(now, timeZone).split('-').map(Number);
  const endDate = new Date(Date.UTC(year, month - 1, 1));
  const startDate = new Date(Date.UTC(year, month - 2, 1));
  const start = formatDateOnly(startDate);
  const end = formatDateOnly(endDate);
  const days = (endDate.getTime() - startDate.getTime()) / DAY_IN_MS;
  return { key: start.slice(0, 7), start, end, days };
}
