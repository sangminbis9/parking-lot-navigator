import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRealtimeParkingCache } from "../src/realtimeParkingCache.js";
import { REALTIME_SYNC_CADENCE_MINUTES, realtimeShardIndex, shouldPruneRealtime } from "../src/jobs.js";
import type { CompositeParkingProvider } from "../../backend/src/providers/CompositeParkingProvider.js";
import { FakeD1, REALTIME_COLUMNS } from "./fakeD1.js";
import type { ParkingLot } from "@parking/shared-types";

// 실시간 주차 sync는 별도 `*/4` Cron에서 shard 하나씩 돈다. shard 4개면
// 약 16분 주기다. 그 로테이션이 heartbeat(30분)·조회 신선도(45분)
// · prune 보존(90분) 계약을 깨지 않는지 센다.
const MINUTE = 60 * 1000;
// epoch 분이 4로 나누어떨어지는 시각이라 T0의 shard 인덱스는 0이다.
const T0 = Date.parse("2026-08-01T00:00:00.000Z");

const SHARD_SOURCES = [
  "seoul-realtime",
  "daejeon-realtime",
  "suseong-realtime",
  "kac-airport-realtime",
] as const;

function lot(source: string, index: number, overrides: Partial<ParkingLot> = {}): ParkingLot {
  return {
    id: `${source}:${index}`,
    source: source as ParkingLot["source"],
    sourceParkingId: String(index),
    name: `${source} 주차장 ${index}`,
    address: "서울 중구",
    lat: 37.56,
    lng: 126.97,
    distanceFromDestinationMeters: 0,
    totalCapacity: 100,
    availableSpaces: 20,
    occupancyRate: 0.8,
    congestionStatus: "moderate",
    realtimeAvailable: true,
    freshnessTimestamp: new Date().toISOString(),
    operatingHours: null,
    feeSummary: null,
    supportsEv: false,
    supportsAccessible: false,
    isPublic: true,
    isPrivate: false,
    stale: false,
    displayStatus: "여유",
    score: 0,
    provenance: [],
    ...overrides,
  };
}

function providerOf(items: () => ParkingLot[]): CompositeParkingProvider {
  return { nearby: async () => items() } as unknown as CompositeParkingProvider;
}

/** shard 하나의 피드. throws가 참이면 그 회차 provider가 실패한다. */
interface ShardFeed {
  items: () => ParkingLot[];
  throws?: boolean;
}

/** 스케줄러와 같은 규칙으로 Cron 회차마다 shard 하나씩 돌린다. 실패는 index.ts처럼 삼킨다. */
async function rotate(
  fake: FakeD1,
  feeds: ShardFeed[],
  runs: number,
  fromRun = 0,
): Promise<{ pruned: number; failures: number }> {
  let pruned = 0;
  let failures = 0;
  for (let run = fromRun; run < fromRun + runs; run += 1) {
    const at = new Date(T0 + run * REALTIME_SYNC_CADENCE_MINUTES * MINUTE);
    vi.setSystemTime(at);
    const feed = feeds[realtimeShardIndex(at, feeds.length)];
    const provider = feed.throws
      ? ({ nearby: async () => { throw new Error("provider down"); } } as unknown as CompositeParkingProvider)
      : providerOf(feed.items);
    try {
      const result = await syncRealtimeParkingCache(fake.asD1(), provider, {
        prune: shouldPruneRealtime(at, feeds.length),
      });
      pruned += result.pruned;
    } catch {
      failures += 1;
    }
  }
  return { pruned, failures };
}

function feedsOf(sources: readonly string[] = SHARD_SOURCES): ShardFeed[] {
  return sources.map((source) => ({ items: () => [lot(source, 1)] }));
}

function db(): FakeD1 {
  return new FakeD1(REALTIME_COLUMNS);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("realtime shard 로테이션", () => {
  it("4분마다 다음 shard로 넘어가고 shard 수만큼 돌면 처음으로 돌아온다", () => {
    const seen = [0, 1, 2, 3, 4, 5].map((m) =>
      realtimeShardIndex(new Date(T0 + m * REALTIME_SYNC_CADENCE_MINUTES * MINUTE), 4),
    );
    expect(seen).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("mock 모드처럼 shard가 하나뿐이면 항상 0이다", () => {
    for (let m = 0; m < 10; m += 1) {
      expect(realtimeShardIndex(new Date(T0 + m * REALTIME_SYNC_CADENCE_MINUTES * MINUTE), 1)).toBe(0);
    }
  });

  it("하루 동안 shard 4개가 각각 90번씩 갱신된다", () => {
    const counts = [0, 0, 0, 0];
    for (let run = 0; run < 1440 / REALTIME_SYNC_CADENCE_MINUTES; run += 1) {
      counts[realtimeShardIndex(new Date(T0 + run * REALTIME_SYNC_CADENCE_MINUTES * MINUTE), 4)] += 1;
    }
    expect(counts).toEqual([90, 90, 90, 90]);
  });

  it("prune은 shard 한 바퀴마다만 돈다 — 4개면 하루 90회", () => {
    let pruneRuns = 0;
    for (let run = 0; run < 1440 / REALTIME_SYNC_CADENCE_MINUTES; run += 1) {
      const at = new Date(T0 + run * REALTIME_SYNC_CADENCE_MINUTES * MINUTE);
      if (shouldPruneRealtime(at, 4)) pruneRuns += 1;
    }
    expect(pruneRuns).toBe(90);
  });

  it("한 shard의 provider가 죽어도 다른 shard는 계속 저장된다", async () => {
    const fake = db();
    const feeds = feedsOf();
    feeds[1] = { items: () => [], throws: true };

    const { failures, pruned } = await rotate(fake, feeds, 40);

    // 40회 중 shard 1 차례 10번이 전부 실패했지만 나머지는 그대로 들어간다.
    expect(failures).toBe(10);
    expect(pruned).toBe(0);
    expect(fake.rows.has("seoul-realtime:1")).toBe(true);
    expect(fake.rows.has("suseong-realtime:1")).toBe(true);
    expect(fake.rows.has("kac-airport-realtime:1")).toBe(true);
    expect(fake.rows.has("daejeon-realtime:1")).toBe(false);
  });

  it("죽은 shard가 이미 저장해 둔 행은 보존 기간 안에서는 지워지지 않는다", async () => {
    const fake = db();
    const feeds = feedsOf();
    await rotate(fake, feeds, 4);
    expect(fake.rows.has("daejeon-realtime:1")).toBe(true);

    feeds[1] = { items: () => [], throws: true };
    // 마지막 성공 뒤 80분까지는 prune 보존(90분) 안이라 살아 있어야 한다.
    const { pruned } = await rotate(fake, feeds, 20, 4);
    expect(pruned).toBe(0);
    expect(fake.rows.has("daejeon-realtime:1")).toBe(true);
  });

  it("prune 회차가 다른 shard의 행을 지우지 않는다", async () => {
    const fake = db();
    // 보존 90분을 여러 번 넘기도록 200회 돌린다. shard 하나는 16분에 한 번만
    // 갱신되지만 heartbeat가 prune 시계를 밀어 준다.
    const { pruned } = await rotate(fake, feedsOf(), 200);

    expect(pruned).toBe(0);
    for (const source of SHARD_SOURCES) {
      expect(fake.rows.has(`${source}:1`)).toBe(true);
    }
  });

  it("값이 그대로여도 로테이션 중 heartbeat가 계속 나가 prune 시계가 멈추지 않는다", async () => {
    const fake = db();
    const runs = 120;
    await rotate(fake, feedsOf(), runs);

    const now = T0 + (runs - 1) * REALTIME_SYNC_CADENCE_MINUTES * MINUTE;
    for (const source of SHARD_SOURCES) {
      const lastSeen = Date.parse(fake.rows.get(`${source}:1`)!.last_seen_at as string);
      // heartbeat 30분 + shard 주기 16분이라 최신 last_seen_at은 46분보다 오래될 수 없다.
      expect(now - lastSeen).toBeLessThanOrEqual(46 * MINUTE);
    }
  });

  it("빈자리가 바뀌면 그 shard의 다음 차례에 반영된다", async () => {
    const fake = db();
    const feeds = feedsOf();
    await rotate(fake, feeds, 8);
    expect(fake.rows.get("suseong-realtime:1")!.available_spaces).toBe(20);

    feeds[2] = { items: () => [lot("suseong-realtime", 1, { availableSpaces: 3 })] };
    await rotate(fake, feeds, 4, 8);

    expect(fake.rows.get("suseong-realtime:1")!.available_spaces).toBe(3);
  });

  it("좌표가 바뀌면 로테이션 중에도 별도 UPDATE로 반영된다", async () => {
    const fake = db();
    const feeds = feedsOf();
    await rotate(fake, feeds, 8);
    fake.reset();

    feeds[0] = { items: () => [lot("seoul-realtime", 1, { lat: 37.6, lng: 127.0 })] };
    await rotate(fake, feeds, 4, 8);

    expect(fake.count("coordinate")).toBe(1);
    const row = fake.rows.get("seoul-realtime:1")!;
    expect(row.lat).toBe(37.6);
    expect(row.lng).toBe(127.0);
  });

  it("피드에서 사라진 주차장은 보존 기간 뒤 prune 회차에 지워지고 다른 shard는 그대로다", async () => {
    const fake = db();
    const feeds = feedsOf();
    feeds[3] = {
      items: () => [lot("kac-airport-realtime", 1), lot("kac-airport-realtime", 2)],
    };
    await rotate(fake, feeds, 4);
    expect(fake.rows.has("kac-airport-realtime:2")).toBe(true);

    feeds[3] = { items: () => [lot("kac-airport-realtime", 1)] };
    // 사라진 행의 last_seen_at은 첫 순회에 멈춘다. 보존 90분이 지난 뒤 처음 오는
    // 순회 시작(prune)에서 지워진다.
    const { pruned } = await rotate(fake, feeds, 35, 4);

    expect(pruned).toBe(1);
    expect(fake.rows.has("kac-airport-realtime:2")).toBe(false);
    for (const source of SHARD_SOURCES) {
      expect(fake.rows.has(`${source}:1`)).toBe(true);
    }
  });
});
