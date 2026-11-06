// 365-day calendar (no leap years) counted in whole days from 1 January of the start year.

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
const MONTH_START: number[] = [];
{
  let acc = 0;
  for (const d of MONTH_DAYS) {
    MONTH_START.push(acc);
    acc += d;
  }
}

export interface CalDate {
  year: number;
  month: number; // 0..11
  day: number; // 1..31
  dayOfYear: number;
}

export function dateOf(day: number, startYear: number): CalDate {
  const year = startYear + Math.floor(day / 365);
  const doy = ((day % 365) + 365) % 365;
  let month = 11;
  while (month > 0 && MONTH_START[month] > doy) month--;
  return { year, month, day: doy - MONTH_START[month] + 1, dayOfYear: doy };
}

export function isMonthStart(day: number): boolean {
  const doy = ((day % 365) + 365) % 365;
  return MONTH_START.includes(doy);
}

export function formatDate(day: number, startYear: number): string {
  const d = dateOf(day, startYear);
  return `${d.day} ${MONTH_SHORT[d.month]} ${d.year}`;
}

export function monthLabel(day: number, startYear: number): string {
  const d = dateOf(day, startYear);
  return `${MONTH_SHORT[d.month]} ${d.year}`;
}
