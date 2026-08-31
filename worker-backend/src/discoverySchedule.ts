export type DiscoverySyncKind = "festivals" | "events";

export const DISCOVERY_PROVIDER_CHUNKS: Array<{
  kind: DiscoverySyncKind;
  providers: string[];
  /// 이 청크만 center당 fetch 제한시간을 따로 쓴다. 생략하면 DISCOVERY_SYNC_FETCH_TIMEOUT_MS.
  fetchTimeoutMs?: number;
  /// 이 청크만 특정 center에서만 조회한다. 생략하면 전국 17개 center 전부.
  /// 원본이 특정 지역만 담은 소스는 나머지 16개 center 호출이 통째로 낭비다.
  centerIds?: string[];
}> = [
  { kind: "festivals", providers: ["tourapi-festival"] },
  // 전국 문화축제 API는 1000행짜리 페이지를 여러 장 받아야 해서 20초 안에 못 끝낸다.
  // (2026-08-02 이후 17개 center 전부 타임아웃 = fetched 0)
  { kind: "festivals", providers: ["public-data-culture-festival"], fetchTimeoutMs: 60000 },
  { kind: "festivals", providers: ["tourapi-area-festival"] },
  { kind: "festivals", providers: ["tourapi-keyword-festival"] },
  // 서울 열린데이터 문화행사는 서울 데이터만 담는다. 전국 17개 center로 부채질하면
  // 16개는 빈 응답을 받으려고 20초 타임아웃을 기다리다 회차 전체를 넘겼다
  // (2026-08-31 실측: 25회 중 24회가 "timed out N/17 centers").
  { kind: "events", providers: ["seoul-culture-event"], centerIds: ["seoul"] },
  { kind: "events", providers: ["culture-portal"] },
  { kind: "events", providers: ["kopis"] },
  // kcisa_428(KOPIS 축제목록) / kcisa_196(지역축제정보)은 2026-08-31에 뺐다.
  // 24시간 내내 sync_runs가 "kcisa_*: API failed: 530 error code: 1016"만 남겼다 —
  // api.kcisa.kr은 국내에서 정상 응답(nginx, 403 JSON)하지만 Worker의 fetch가
  // 그 호스트에 닿지 못한다. 우리 쪽에서 고칠 방법이 없고, 두 소스가 주는 데이터는
  // 이미 kopis 프로바이더와 public-data-culture-festival이 덮는다.
  // 복구하려면 이 두 줄을 되살리면 된다(secret과 env는 그대로 남겨 뒀다).
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
