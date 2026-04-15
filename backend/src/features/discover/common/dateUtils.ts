import type { DiscoverStatus } from "@parking/shared-types";

export function formatCompactDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

export function parseDate(value: string): string {
  const cleaned = value.replaceAll("-", "").replaceAll(".", "").trim();
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  return value.slice(0, 10);
}

export function discoverStatus(startDate: string, endDate: string, now = new Date()): DiscoverStatus {
  const today = formatIsoDate(now);
  if (startDate <= today && endDate >= today) return "ongoing";
  return "upcoming";
}

export function isWithinWindow(startDate: string, endDate: string, upcomingWithinDays: number, now = new Date()): boolean {
  const today = formatIsoDate(now);
  const windowEnd = formatIsoDate(new Date(now.getTime() + upcomingWithinDays * 24 * 60 * 60 * 1000));
  return endDate >= today && startDate <= windowEnd;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
