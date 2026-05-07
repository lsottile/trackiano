export function getPeriodStart(now = new Date()) {
  const payDay = Number(process.env.PAY_DATE_DAY) || null;
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (!payDay) return new Date(year, month, 1);

  return day >= payDay
    ? new Date(year, month, payDay)
    : new Date(year, month - 1, payDay);
}

export function daysUntilPayday(now = new Date()) {
  const payDay = Number(process.env.PAY_DATE_DAY) || null;
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  let nextPay;
  if (!payDay) {
    nextPay = new Date(year, month + 1, 0);
  } else {
    nextPay = day < payDay
      ? new Date(year, month, payDay)
      : new Date(year, month + 1, payDay);
  }

  return Math.max(1, Math.ceil((nextPay - now) / (1000 * 60 * 60 * 24)));
}

export function daysSincePeriodStart(now = new Date()) {
  const start = getPeriodStart(now);
  return Math.max(1, Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1);
}
