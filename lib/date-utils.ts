const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const next = parseDate(date);
  next.setDate(next.getDate() + days);
  return toDateKey(next);
}

export function diffDays(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
}

export function inclusiveDays(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

export function isBetween(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(parseDate(date));
}

export function formatDateRange(start: string, end: string): string {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function monthTitle(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number | undefined {
  const mean = average(values);
  if (mean === undefined || values.length < 2) return undefined;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
