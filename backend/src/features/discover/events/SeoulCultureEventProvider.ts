import type { FreeEvent } from "@parking/shared-types";
import { BaseProviderHealth } from "../../../providers/BaseProviderHealth.js";
import { distanceMeters } from "../../../services/geo.js";
import type { DiscoverQuery, EventProvider } from "../common/discoverProvider.js";
import { discoverStatus, isWithinWindow, parseDate } from "../common/dateUtils.js";
import { sortByStatusThenDistance } from "../common/sortDiscover.js";

interface SeoulCultureEventRow {
  CODENAME?: string;
  TITLE?: string;
  DATE?: string;
  PLACE?: string;
  ORG_NAME?: string;
  USE_FEE?: string;
  MAIN_IMG?: string;
  ORG_LINK?: string;
  GUNAME?: string;
  LOT?: string;
  LAT?: string;
  RGSTDATE?: string;
}

export class SeoulCultureEventProvider extends BaseProviderHealth implements EventProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {
    super("seoul-culture-event");
  }

  async events(query: DiscoverQuery): Promise<FreeEvent[]> {
    try {
      const url = new URL(`${this.apiKey}/json/culturalEventInfo/1/200`, ensureTrailingSlash(this.baseUrl));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Seoul culture event failed: ${response.status}`);
      const body = (await response.json()) as { culturalEventInfo?: { row?: SeoulCultureEventRow[] } };
      const rows = body.culturalEventInfo?.row ?? [];
      const items = dedupeEvents(
        rows
          .map((row) => normalizeSeoulEvent(row, query))
          .filter((item): item is FreeEvent => Boolean(item))
          .filter((item) => item.distanceMeters <= query.radiusMeters)
          .filter((item) => isWithinWindow(item.startDate, item.endDate, query.upcomingWithinDays))
          .filter((item) => !query.ongoingOnly || item.status === "ongoing")
          .filter((item) => !query.freeOnly || item.isFree)
      );
      this.markSuccess(items.length > 0 ? 0.86 : 0.65);
      return sortByStatusThenDistance(items);
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}

function normalizeSeoulEvent(row: SeoulCultureEventRow, query: DiscoverQuery): FreeEvent | null {
  const lat = Number(row.LAT);
  const lng = Number(row.LOT);
  const dates = parseDateRange(row.DATE ?? "");
  if (!row.TITLE || !dates || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const feeText = row.USE_FEE ?? "";
  const lowerFeeText = feeText.toLowerCase();
  const isFree = feeText.includes("\uBB34\uB8CC") || feeText.includes("0\uC6D0") || lowerFeeText.includes("free");
  return {
    id: `seoul-culture:${hashKey(`${row.TITLE}|${row.PLACE}|${row.DATE}`)}`,
    title: row.TITLE,
    eventType: row.CODENAME ?? "culture",
    startDate: dates.startDate,
    endDate: dates.endDate,
    status: discoverStatus(dates.startDate, dates.endDate),
    isFree,
    venueName: row.PLACE ?? null,
    address: [row.GUNAME, row.PLACE].filter(Boolean).join(" "),
    lat,
    lng,
    distanceMeters: distanceMeters(query.lat, query.lng, lat, lng),
    source: "seoul-open-data",
    sourceUrl: row.ORG_LINK ?? null,
    imageUrl: row.MAIN_IMG ?? null,
    shortDescription: row.ORG_NAME ?? null
  };
}

function parseDateRange(value: string): { startDate: string; endDate: string } | null {
  const matches = [...value.matchAll(/\d{4}[-.]\d{2}[-.]\d{2}/g)].map((match) => parseDate(match[0]));
  if (matches.length === 0) return null;
  return {
    startDate: matches[0],
    endDate: matches[matches.length - 1] ?? matches[0]
  };
}

function dedupeEvents(items: FreeEvent[]): FreeEvent[] {
  const seen = new Map<string, FreeEvent>();
  for (const item of items) {
    const key = `${item.title}|${item.venueName ?? ""}|${item.startDate}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function hashKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
