function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : fallback;
}

export function culturePortalMaxPages(): number {
  return parsePositiveInt(process.env.CULTURE_PORTAL_MAX_PAGES, 30);
}

export function kcisaMaxPages(): number {
  return parsePositiveInt(process.env.KCISA_MAX_PAGES, 100);
}

export function kopisMaxPages(): number {
  return parsePositiveInt(process.env.KOPIS_MAX_PAGES, 100);
}

export function kopisDetailMaxItems(): number {
  return parseNonNegativeInt(process.env.KOPIS_DETAIL_MAX_ITEMS, 20);
}

export function seoulCultureMaxPages(): number {
  return parsePositiveInt(process.env.SEOUL_CULTURE_MAX_PAGES, 10);
}

export function eventGeocodeMissBudget(): number {
  return parsePositiveInt(process.env.EVENT_GEOCODE_MISS_BUDGET, 50);
}
