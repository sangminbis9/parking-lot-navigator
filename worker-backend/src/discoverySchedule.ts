export type DiscoverySyncKind = "festivals" | "events";

export const DISCOVERY_PROVIDER_CHUNKS: Array<{
  kind: DiscoverySyncKind;
  providers: string[];
  /// 이 청크만 center당 fetch 제한시간을 따로 쓴다. 생략하면 DISCOVERY_SYNC_FETCH_TIMEOUT_MS.
  fetchTimeoutMs?: number;
}> = [
  { kind: "festivals", providers: ["tourapi-festival"] },
  // 전국 문화축제 API는 1000행짜리 페이지를 여러 장 받아야 해서 20초 안에 못 끝낸다.
  // (2026-08-02 이후 17개 center 전부 타임아웃 = fetched 0)
  { kind: "festivals", providers: ["public-data-culture-festival"], fetchTimeoutMs: 60000 },
  { kind: "festivals", providers: ["tourapi-area-festival"] },
  { kind: "festivals", providers: ["tourapi-keyword-festival"] },
  { kind: "events", providers: ["seoul-culture-event"] },
  { kind: "events", providers: ["culture-portal"] },
  { kind: "events", providers: ["kopis"] },
  { kind: "events", providers: ["kcisa_428"] },
  { kind: "events", providers: ["kcisa_196"] },
  { kind: "festivals", providers: ["city-scraped"] },
  { kind: "festivals", providers: ["akei-trade-expo"] },
];

export const DISCOVERY_PROVIDER_CHUNK_COUNT =
  DISCOVERY_PROVIDER_CHUNKS.length;

export function currentDiscoveryChunkIndex(date: Date = new Date()): number {
  const slotsPerHour = 7;
  const slot =
    date.getUTCHours() * slotsPerHour + Math.floor(date.getUTCMinutes() / 9);
  return slot % DISCOVERY_PROVIDER_CHUNK_COUNT;
}
