const DEFAULT_TOUR_FESTIVAL_MAX_PAGES = 20;

export function tourFestivalMaxPages(): number {
  const raw = process.env.TOUR_FESTIVAL_MAX_PAGES;
  if (!raw) return DEFAULT_TOUR_FESTIVAL_MAX_PAGES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_TOUR_FESTIVAL_MAX_PAGES;
}
