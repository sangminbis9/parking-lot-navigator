export const CITY_FESTIVAL_CHUNK_SIZE = 15;

export function currentCityFestivalChunkIndex(date: Date, siteCount: number): number {
  const chunkCount = Math.max(1, Math.ceil(siteCount / CITY_FESTIVAL_CHUNK_SIZE));
  const epochDay = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  return epochDay % chunkCount;
}

export function sitesForChunk<T>(sites: T[], chunkIndex: number, chunkSize: number): T[] {
  const start = chunkIndex * chunkSize;
  return sites.slice(start, start + chunkSize);
}
