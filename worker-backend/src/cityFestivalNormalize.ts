import type { EventCoordinateResolver } from "../../backend/src/features/discover/events/eventProviderUtils.js";
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
  // "2026. 07. 15(수)"처럼 구분자 뒤에 공백이 붙는 사이트가 있어 구분자
  // 앞뒤 공백을 허용한다(예: 철원문화재단).
  /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g,
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
  input: { title: string; venueRaw: string | null; addressRaw: string | null; lat?: number | null; lng?: number | null },
  config: CitySiteConfig,
  resolver: EventCoordinateResolver | null
): Promise<{ lat: number; lng: number }> {
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    return { lat: input.lat, lng: input.lng };
  }

  const address = input.addressRaw?.trim();
  const venue = input.venueRaw?.trim();
  if ((!address && !venue) || !resolver) {
    return { lat: config.fallbackLat, lng: config.fallbackLng };
  }

  try {
    const resolved = await resolver.resolve({
      title: input.title,
      venue: venue ?? null,
      address: address ?? null,
      region: config.cityName
    });
    if (resolved) return { lat: resolved.lat, lng: resolved.lng };
  } catch {
    // best-effort: geocoding 실패는 fallback 좌표로 무시한다
  }
  return { lat: config.fallbackLat, lng: config.fallbackLng };
}

export async function normalizeCandidate(
  candidate: RawCityFestivalCandidate,
  config: CitySiteConfig,
  resolver: EventCoordinateResolver | null = null
): Promise<NormalizedCityFestival | null> {
  const title = candidate.title?.trim();
  if (!title) return null;

  const dateRange = parseCityDateRange(candidate.startDateRaw, candidate.endDateRaw);
  if (!dateRange) return null;

  const { lat, lng } = await resolveCoordinates(
    { title, venueRaw: candidate.venueRaw, addressRaw: candidate.addressRaw, lat: candidate.lat, lng: candidate.lng },
    config,
    resolver
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
