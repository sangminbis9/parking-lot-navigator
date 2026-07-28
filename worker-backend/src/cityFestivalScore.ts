import type { NormalizedCityFestival } from "./cityFestivalNormalize.js";

export function isWithinKoreaBounds(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

export function scoreCandidate(normalized: NormalizedCityFestival): number {
  let score = 0;
  if (normalized.title.length >= 2) score += 0.3;
  if (normalized.startDate <= normalized.endDate) score += 0.3;
  if (isWithinKoreaBounds(normalized.lat, normalized.lng)) score += 0.2;
  if (normalized.hasDetailUrl) score += 0.2;
  return score;
}
