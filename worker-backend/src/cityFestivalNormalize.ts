import { getGeocodeStore } from "../../backend/src/features/discover/events/eventProviderUtils.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./cityFestivalParsers/types.js";

export interface NormalizedCityFestival {
  siteId: string;
  sourceUrl: string;
  hasDetailUrl: boolean;
  title: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  address: string | null;
  lat: number;
  lng: number;
  imageUrl: string | null;
}

const DATE_PATTERNS = [
  /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g,
  /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
];

function extractDates(raw: string): string[] {
  for (const pattern of DATE_PATTERNS) {
    const regex = new RegExp(pattern.source, "g");
    const dates: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      const [, year, month, day] = match;
      dates.push(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    }
    if (dates.length > 0) return dates;
  }
  return [];
}

export function parseCityDateRange(
  startRaw: string | null,
  endRaw: string | null
): { startDate: string; endDate: string } | null {
  const startCandidates = startRaw ? extractDates(startRaw) : [];
  if (startCandidates.length === 0) return null;

  const startDate = startCandidates[0];
  if (startCandidates.length >= 2) {
    const endDate = startCandidates[1];
    return { startDate, endDate: endDate >= startDate ? endDate : startDate };
  }

  const endCandidates = endRaw && endRaw !== startRaw ? extractDates(endRaw) : [];
  const endDate = endCandidates[0] ?? startDate;
  return { startDate, endDate: endDate >= startDate ? endDate : startDate };
}

async function resolveCoordinates(
  addressRaw: string | null,
  fallbackLat: number,
  fallbackLng: number
): Promise<{ lat: number; lng: number }> {
  const query = addressRaw?.trim();
  if (!query) return { lat: fallbackLat, lng: fallbackLng };

  const store = getGeocodeStore();
  if (!store) return { lat: fallbackLat, lng: fallbackLng };

  try {
    const entries = await store.getMany([query]);
    const entry = entries.get(query);
    if (entry?.found && entry.lat !== null && entry.lng !== null) {
      return { lat: entry.lat, lng: entry.lng };
    }
  } catch {
    // best-effort: geocode 캐시 조회 실패는 fallback 좌표로 무시한다
  }
  return { lat: fallbackLat, lng: fallbackLng };
}

export async function normalizeCandidate(
  candidate: RawCityFestivalCandidate,
  config: CitySiteConfig
): Promise<NormalizedCityFestival | null> {
  const title = candidate.title?.trim();
  if (!title) return null;

  const dateRange = parseCityDateRange(candidate.startDateRaw, candidate.endDateRaw);
  if (!dateRange) return null;

  const { lat, lng } = await resolveCoordinates(
    candidate.addressRaw,
    config.fallbackLat,
    config.fallbackLng
  );

  const detailUrl = candidate.detailUrl?.trim() || null;

  return {
    siteId: config.siteId,
    sourceUrl: detailUrl ?? config.listUrl,
    hasDetailUrl: detailUrl !== null,
    title,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    venue: candidate.venueRaw?.trim() || null,
    address: candidate.addressRaw?.trim() || null,
    lat,
    lng,
    imageUrl: candidate.imageUrl?.trim() || null
  };
}
