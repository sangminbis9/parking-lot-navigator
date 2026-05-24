const DEFAULT_TOUR_FESTIVAL_MAX_PAGES = 20;
const DEFAULT_NATIONAL_CULTURE_MAX_PAGES = 20;

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
