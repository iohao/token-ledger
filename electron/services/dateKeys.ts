export function parseTimestamp(value: string): Date | null {
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

export function dateKeyFor(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(date);
  } catch (error) {
    throw new Error(`unsupported time zone: ${timeZone}`);
  }
}

export function monthKeyFor(date: Date, timeZone: string): string {
  const dateKey = dateKeyFor(date, timeZone);
  return dateKey.slice(0, 7);
}

export function addDaysToDateKey(dateKey: string, deltaDays: number): string {
  const parts = dateKey.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`unsupported date key: ${dateKey}`);
  }
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function lastNDateKeys(now: Date, timeZone: string, count: number): string[] {
  const todayKey = dateKeyFor(now, timeZone);
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(addDaysToDateKey(todayKey, -i));
  }
  return result;
}

export function formatUtcTimestamp(date: Date): string {
  return date.toISOString();
}
