// 청크당 사이트 목록 fetch(사이트 수) + detail-fetch budget + Kakao geocode miss
// budget이 한 invocation의 subrequest 총량을 이룬다. 15개 사이트 청크(경남/전북)는
// 20+20 예산과 합쳐 55회로 Workers subrequest 한도를 넘어 뒤쪽 사이트가 통째로
// 스킵됐다(2026-08-09 wrangler tail로 "Too many subrequests" 확인, 10개 사이트
// 청크는 50회로 안전했음). 청크당 사이트 수를 줄여 여유를 둔다.
export const CITY_FESTIVAL_CHUNK_SIZE = 10;

export function currentCityFestivalChunkIndex(date: Date, siteCount: number): number {
  const chunkCount = Math.max(1, Math.ceil(siteCount / CITY_FESTIVAL_CHUNK_SIZE));
  const epochDay = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  return epochDay % chunkCount;
}

export function sitesForChunk<T>(sites: T[], chunkIndex: number, chunkSize: number): T[] {
  const start = chunkIndex * chunkSize;
  return sites.slice(start, start + chunkSize);
}
