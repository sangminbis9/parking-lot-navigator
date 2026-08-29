import { describe, expect, it } from "vitest";
import {
  pruneStaleDiscovery,
  upsertDiscoveryItems,
} from "../src/discoveryCache.js";
import { DISCOVERY_COLUMNS, FakeD1 } from "./fakeD1.js";
import type { Festival } from "@parking/shared-types";

// D1 무료 한도(하루 쓰기 100,000행)에서 가장 큰 항목이 discovery_items upsert였다.
// 같은 행사가 하루 여러 번 다시 들어오는데 대부분 내용이 그대로이므로, "바뀐 것만
// 쓴다"가 지켜지는지를 쓰기 문장 수로 직접 센다.
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function festival(overrides: Partial<Festival> = {}): Festival {
  return {
    id: "1100492",
    title: "축제",
    subtitle: null,
    startDate: "2099-01-01",
    endDate: "2099-01-02",
    status: "upcoming",
    venueName: null,
    address: "서울 중구",
    lat: 37.5,
    lng: 127,
    distanceMeters: 0,
    source: "tourapi",
    sourceUrl: null,
    imageUrl: null,
    tags: [],
    ...overrides,
  };
}

function db(): FakeD1 {
  return new FakeD1(DISCOVERY_COLUMNS);
}

describe("upsertDiscoveryItems 조건부 쓰기", () => {
  it("신규 행사는 INSERT 한 건을 낸다", async () => {
    const fake = db();
    const counts = await upsertDiscoveryItems(fake.asD1(), [festival()], at(0));

    expect(counts).toMatchObject({ inserted: 1, changed: 0, heartbeat: 0, writes: 1 });
    expect(fake.count("insert")).toBe(1);
  });

  it("내용이 같고 heartbeat 간격 전이면 아무것도 쓰지 않는다", async () => {
    const fake = db();
    await upsertDiscoveryItems(fake.asD1(), [festival()], at(0));
    fake.reset();

    const counts = await upsertDiscoveryItems(
      fake.asD1(),
      [festival()],
      at(23 * HOUR),
    );

    expect(counts).toMatchObject({ unchangedSkipped: 1, writes: 0 });
    expect(fake.writes).toBe(0);
  });

  it("내용이 같고 heartbeat 간격이 지나면 최소 UPDATE 한 건만 낸다", async () => {
    const fake = db();
    await upsertDiscoveryItems(fake.asD1(), [festival()], at(0));
    fake.reset();

    const counts = await upsertDiscoveryItems(
      fake.asD1(),
      [festival()],
      at(24 * HOUR),
    );

    expect(counts).toMatchObject({ heartbeat: 1, changed: 0, writes: 1 });
    expect(fake.count("heartbeat")).toBe(1);
    expect(fake.count("insert")).toBe(0);
    // heartbeat가 시계를 밀어 줬으므로 바로 다음 회차는 다시 조용해진다.
    fake.reset();
    await upsertDiscoveryItems(fake.asD1(), [festival()], at(25 * HOUR));
    expect(fake.writes).toBe(0);
  });

  it.each([
    ["title", { title: "새 축제" }],
    ["startDate", { startDate: "2099-02-01" }],
    ["admissionFee", { admissionFee: "성인 10,000원" }],
    ["imageUrl", { imageUrl: "https://example.com/a.jpg" }],
    ["programInfo", { programInfo: "공연시간: 10:00~18:00" }],
    ["address", { address: "부산 중구" }],
  ])("%s가 바뀌면 heartbeat를 기다리지 않고 바로 UPDATE한다", async (_name, patch) => {
    const fake = db();
    await upsertDiscoveryItems(fake.asD1(), [festival()], at(0));
    fake.reset();

    const counts = await upsertDiscoveryItems(
      fake.asD1(),
      [festival(patch as Partial<Festival>)],
      at(HOUR),
    );

    expect(counts).toMatchObject({ changed: 1, heartbeat: 0, writes: 1 });
  });

  it("좌표가 바뀌면 바로 반영한다", async () => {
    const fake = db();
    await upsertDiscoveryItems(fake.asD1(), [festival()], at(0));
    fake.reset();

    const counts = await upsertDiscoveryItems(
      fake.asD1(),
      [festival({ lat: 37.6, lng: 127.1 })],
      at(HOUR),
    );

    expect(counts.changed).toBe(1);
  });

  it("backfill이 채운 요금·프로그램이 남아 있으면 다음 sync는 쓰기를 내지 않는다", async () => {
    const fake = db();
    // 상세 조회가 채운 상태를 심는다.
    await upsertDiscoveryItems(
      fake.asD1(),
      [festival({ admissionFee: "성인 10,000원", programInfo: "10:00~18:00" })],
      at(0),
    );
    fake.reset();

    // 다음 sync의 목록 응답에는 요금도 프로그램도 없다.
    const counts = await upsertDiscoveryItems(fake.asD1(), [festival()], at(HOUR));

    expect(counts).toMatchObject({ unchangedSkipped: 1, writes: 0 });
    const row = fake.rows.get("festival:1100492")!;
    expect(row.lowest_price_text).toBe("성인 10,000원");
    expect(JSON.parse(row.raw_payload as string).programInfo).toBe("10:00~18:00");
  });

  it("같은 행사 100건을 10번 sync해도 INSERT 100건 뒤로는 늘지 않는다", async () => {
    const fake = db();
    const items = Array.from({ length: 100 }, (_, i) =>
      festival({ id: `item-${i}` }),
    );

    let writes = 0;
    for (let round = 0; round < 10; round += 1) {
      // 9분 로테이션을 흉내내 1시간 간격으로 10회 — heartbeat 24시간에 못 미친다.
      const counts = await upsertDiscoveryItems(fake.asD1(), items, at(round * HOUR));
      writes += counts.writes;
    }

    expect(writes).toBe(100);
    expect(fake.writes).toBe(100);
  });
});

describe("pruneStaleDiscovery", () => {
  it("heartbeat가 살아 있는 행은 지우지 않고, 오래 안 보인 행만 지운다", async () => {
    const fake = db();
    const now = Date.now();
    const alive = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const gone = new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString();
    await upsertDiscoveryItems(fake.asD1(), [festival({ id: "alive" })], alive);
    await upsertDiscoveryItems(fake.asD1(), [festival({ id: "gone" })], gone);

    const pruned = await pruneStaleDiscovery(fake.asD1(), "festival");

    expect(pruned).toBe(1);
    expect(fake.rows.has("festival:alive")).toBe(true);
    expect(fake.rows.has("festival:gone")).toBe(false);
  });
});
