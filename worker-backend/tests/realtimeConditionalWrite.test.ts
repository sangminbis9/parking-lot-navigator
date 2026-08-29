import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncRealtimeParkingCache } from "../src/realtimeParkingCache.js";
import type { CompositeParkingProvider } from "../../backend/src/providers/CompositeParkingProvider.js";
import { FakeD1, REALTIME_COLUMNS } from "./fakeD1.js";
import type { ParkingLot } from "@parking/shared-types";

// realtime_parking_status는 3분마다 866행을 통째로 다시 쓰고 있었다(하루 쓰기의 72%).
// sync 주기와 노출 신선도를 그대로 두고 "값이 바뀐 행만 쓴다"가 지켜지는지 센다.
const MINUTE = 60 * 1000;
const T0 = Date.parse("2026-08-01T00:00:00.000Z");

function lot(overrides: Partial<ParkingLot> = {}): ParkingLot {
  return {
    id: "daejeon-realtime:1",
    source: "daejeon-realtime",
    sourceParkingId: "1",
    name: "시청 주차장",
    address: "대전 서구",
    lat: 36.35,
    lng: 127.38,
    distanceFromDestinationMeters: 0,
    totalCapacity: 100,
    availableSpaces: 20,
    occupancyRate: 0.8,
    congestionStatus: "moderate",
    realtimeAvailable: true,
    // 대전 피드는 원본에 시각이 없어 provider가 매 회차 now를 채운다.
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

describe("syncRealtimeParkingCache 조건부 쓰기", () => {
  it("첫 회차는 INSERT, 값이 그대로면 다음 회차는 쓰지 않는다", async () => {
    const fake = db();
    const first = await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [lot()]));
    expect(first).toMatchObject({ inserted: 1, upserted: 1 });

    fake.reset();
    vi.setSystemTime(T0 + 3 * MINUTE);
    const second = await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [lot()]));

    // freshness_timestamp만 매 회차 달라지는 것은 "변경"이 아니다.
    expect(second).toMatchObject({ unchangedSkipped: 1, changed: 0, upserted: 0 });
    expect(fake.writes).toBe(0);
  });

  it("빈자리가 20에서 18로 바뀌면 그 회차에 바로 반영한다", async () => {
    const fake = db();
    await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [lot()]));
    fake.reset();

    vi.setSystemTime(T0 + 3 * MINUTE);
    const result = await syncRealtimeParkingCache(
      fake.asD1(),
      providerOf(() => [lot({ availableSpaces: 18 })]),
    );

    expect(result).toMatchObject({ changed: 1, upserted: 1 });
    expect(fake.rows.get("daejeon-realtime:1")!.available_spaces).toBe(18);
  });

  it("좌표가 바뀌면 별도 UPDATE로 반영한다", async () => {
    const fake = db();
    await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [lot()]));
    fake.reset();

    vi.setSystemTime(T0 + 3 * MINUTE);
    const result = await syncRealtimeParkingCache(
      fake.asD1(),
      providerOf(() => [lot({ lat: 36.36, lng: 127.39 })]),
    );

    expect(result.coordinate).toBe(1);
    const row = fake.rows.get("daejeon-realtime:1")!;
    expect(row.lat).toBe(36.36);
    expect(row.lng).toBe(127.39);
    // 좌표 UPDATE는 last_seen_at을 건드리지 않으므로 heartbeat가 같이 나가야 한다.
    expect(row.last_seen_at).toBe(new Date(T0 + 3 * MINUTE).toISOString());
  });

  it("값이 30분간 그대로면 heartbeat 한 건으로 last_seen_at을 민다", async () => {
    const fake = db();
    await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [lot()]));

    let heartbeats = 0;
    let writes = 0;
    // 3분 간격 20회 = 60분. heartbeat 30분이므로 두 번만 나가야 한다.
    for (let round = 1; round <= 20; round += 1) {
      vi.setSystemTime(T0 + round * 3 * MINUTE);
      const result = await syncRealtimeParkingCache(
        fake.asD1(),
        providerOf(() => [lot()]),
      );
      heartbeats += result.heartbeat;
      writes += result.upserted;
    }

    expect(heartbeats).toBe(2);
    expect(writes).toBe(2);
  });

  it("provider가 계속 주는 주차장은 값이 안 변해도 prune에 걸리지 않는다", async () => {
    const fake = db();
    // 3분 간격으로 4시간(prune 보존 90분의 2.7배)을 돌린다.
    for (let round = 0; round <= 80; round += 1) {
      vi.setSystemTime(T0 + round * 3 * MINUTE);
      const result = await syncRealtimeParkingCache(
        fake.asD1(),
        providerOf(() => [lot()]),
      );
      expect(result.pruned).toBe(0);
    }
    expect(fake.rows.has("daejeon-realtime:1")).toBe(true);
  });

  it("피드에서 사라진 주차장은 last_seen_at이 멈추고 보존 기간 뒤 지워진다", async () => {
    const fake = db();
    await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [lot()]));
    const other = lot({ id: "daejeon-realtime:2", sourceParkingId: "2" });

    // 60분 뒤: 아직 조회 신선도(45분)는 지났지만 prune 보존(90분) 전이라 행은 남는다.
    vi.setSystemTime(T0 + 60 * MINUTE);
    const mid = await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [other]));
    expect(mid.pruned).toBe(0);
    expect(fake.rows.has("daejeon-realtime:1")).toBe(true);

    vi.setSystemTime(T0 + 95 * MINUTE);
    const late = await syncRealtimeParkingCache(fake.asD1(), providerOf(() => [other]));
    expect(late.pruned).toBe(1);
    expect(fake.rows.has("daejeon-realtime:1")).toBe(false);
  });

  it("같은 주차장 500개를 3분 간격 20회 sync해도 10,000건을 쓰지 않는다", async () => {
    const fake = db();
    const items = Array.from({ length: 500 }, (_, i) =>
      lot({ id: `daejeon-realtime:${i}`, sourceParkingId: String(i) }),
    );

    let writes = 0;
    for (let round = 0; round < 20; round += 1) {
      vi.setSystemTime(T0 + round * 3 * MINUTE);
      const result = await syncRealtimeParkingCache(
        fake.asD1(),
        providerOf(() => items),
      );
      writes += result.upserted;
    }

    // INSERT 500 + 57분 구간의 heartbeat 1회 500 = 1,000건.
    expect(writes).toBe(1000);
  });
});
