const DEFAULT_TOUR_FESTIVAL_MAX_PAGES = 20;
const DEFAULT_NATIONAL_CULTURE_MAX_PAGES = 20;
const DEFAULT_TOUR_ENRICH_MAX_ITEMS = 300;
const DEFAULT_TOUR_AREA_FESTIVAL_MAX_PAGES = 3;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function tourFestivalMaxPages(): number {
  return parsePositiveInt(
    process.env.TOUR_FESTIVAL_MAX_PAGES,
    DEFAULT_TOUR_FESTIVAL_MAX_PAGES,
  );
}

export function nationalCultureMaxPages(): number {
  return parsePositiveInt(
    process.env.NATIONAL_CULTURE_MAX_PAGES,
    DEFAULT_NATIONAL_CULTURE_MAX_PAGES,
  );
}

// detailCommon2/detailImage2 enrichment costs 2 subrequests per item with no
// built-in cap, which trips Cloudflare Workers' per-invocation subrequest
// limit once a provider's item count grows past a few hundred.
export function tourEnrichMaxItems(): number {
  return parsePositiveInt(
    process.env.TOUR_ENRICH_MAX_ITEMS,
    DEFAULT_TOUR_ENRICH_MAX_ITEMS,
  );
}

// areaBasedList2 fans out across 17 area codes, so even a modest per-area
// page cap multiplies into a lot of listing subrequests. Keep this well
// below tourFestivalMaxPages(), which is sized for a single nationwide list.
export function tourAreaFestivalMaxPages(): number {
  return parsePositiveInt(
    process.env.TOUR_AREA_FESTIVAL_MAX_PAGES,
    DEFAULT_TOUR_AREA_FESTIVAL_MAX_PAGES,
  );
}
