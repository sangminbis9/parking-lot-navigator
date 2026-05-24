export function tourFestivalMaxPages(): number {
  const raw = process.env.TOUR_FESTIVAL_MAX_PAGES;
  if (!raw) return 5;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}
