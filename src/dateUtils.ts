const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GOOGLE_SHEETS_EPOCH = Date.UTC(1899, 11, 30);

export function getTodayInTimezone(timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date());
}

export function getTargetDate(timezone: string): string {
  const targetDate = process.env.TARGET_DATE?.trim();
  if (!targetDate) {
    return getTodayInTimezone(timezone);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("TARGET_DATE must be YYYY-MM-DD");
  }

  return targetDate;
}

export function parseSheetDate(value: unknown, timezone: string): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return serialDateToIsoDate(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  if (!text) {
    return null;
  }

  const normalized = text
    .replace(/[年月]/g, "/")
    .replace(/日/g, "")
    .replace(/-/g, "/")
    .trim();

  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

function serialDateToIsoDate(serial: number): string {
  const wholeDays = Math.floor(serial);
  const date = new Date(GOOGLE_SHEETS_EPOCH + wholeDays * MS_PER_DAY);
  return date.toISOString().slice(0, 10);
}
