import { describe, expect, it, vi } from "vitest";
import type { ApnsSender } from "../src/apns.js";
import {
  addDays,
  buildNotification,
  dispatchPendingNotifications,
  isWithinQuietHours,
  planUpcomingNotifications,
  seoulDayString,
  targetDates,
} from "../src/upcomingNotifications.js";

type Row = Record<string, unknown>;

/** notification_sends 상태를 실제로 들고 있는 D1 흉내. 중복 발송 테스트에 필요하다. */
function fakeDb(seed: {
  festivals?: Row[];
  localEvents?: Row[];
  devices?: Row[];
}) {
  const festivals = seed.festivals ?? [];
  const localEvents = seed.localEvents ?? [];
  const devices = seed.devices ?? [];
  const sends = new Map<string, Row>();

  const exec = (sql: string, args: unknown[]) => {
    if (sql.includes("FROM discovery_items")) {
      const dates = args as string[];
      return {
        results: festivals.filter((row) => dates.includes(row.start_date as string)),
      };
    }
    if (sql.includes("FROM local_events")) {
      const dates = args as string[];
      return {
        results: localEvents.filter((row) => dates.includes(row.start_date as string)),
      };
    }
    if (sql.includes("FROM notification_devices")) {
      return {
        results: devices.filter(
          (row) =>
            row.apns_token &&
            (row.festival_enabled === 1 || row.local_event_enabled === 1),
        ),
      };
    }
    if (sql.includes("INSERT OR IGNORE INTO notification_sends")) {
      const [device_id, event_id, notification_type, event_kind, event_title, event_start_date, planned_at] =
        args as string[];
      const key = `${device_id}|${event_id}|${notification_type}`;
      if (!sends.has(key)) {
        sends.set(key, {
          device_id,
          event_id,
          notification_type,
          event_kind,
          event_title,
          event_start_date,
          planned_at,
          sent_at: null,
          attempts: 0,
        });
      }
      return { results: [] };
    }
    if (sql.includes("FROM notification_sends")) {
      return {
        results: [...sends.values()]
          .filter((row) => row.sent_at === null)
          .sort((a, b) =>
            `${a.device_id}${a.notification_type}${a.event_start_date}`.localeCompare(
              `${b.device_id}${b.notification_type}${b.event_start_date}`,
            ),
          ),
      };
    }
    if (sql.includes("UPDATE notification_sends SET sent_at")) {
      const [sent_at, device_id, event_id, notification_type] = args as string[];
      const row = sends.get(`${device_id}|${event_id}|${notification_type}`);
      if (row) {
        row.sent_at = sent_at;
        row.attempts = (row.attempts as number) + 1;
      }
      return { results: [] };
    }
    if (sql.includes("UPDATE notification_sends SET attempts")) {
      const [last_error, device_id, event_id, notification_type] = args as string[];
      const row = sends.get(`${device_id}|${event_id}|${notification_type}`);
      if (row) {
        row.attempts = (row.attempts as number) + 1;
        row.last_error = last_error;
      }
      return { results: [] };
    }
    if (sql.includes("UPDATE notification_devices SET apns_token = NULL")) {
      const deviceId = args[1] as string;
      const device = devices.find((row) => row.device_id === deviceId);
      if (device) device.apns_token = null;
      return { results: [] };
    }
    throw new Error(`unhandled sql: ${sql}`);
  };

  const statement = (sql: string, args: unknown[]) => ({
    run: async () => exec(sql, args),
    all: async () => exec(sql, args),
    first: async () => exec(sql, args).results?.[0] ?? null,
    __exec: () => exec(sql, args),
  });

  const db = {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => statement(sql, args),
        ...statement(sql, []),
      };
    },
    async batch(statements: { __exec: () => unknown }[]) {
      return statements.map((statement) => statement.__exec());
    },
  } as unknown as D1Database;

  return { db, sends };
}

// 제목+시작일이 같으면 dedupeEvents가 하나로 합치므로 id마다 제목을 다르게 둔다.
function festivalRow(overrides: Row): Row {
  const id = (overrides.id as string) ?? "f1";
  return {
    id,
    title: `테스트 축제 ${id}`,
    address: "인천광역시 연수구 송도동",
    start_date: "2026-10-31",
    primary_category: "general_event",
    ...overrides,
  };
}

function deviceRow(overrides: Row): Row {
  return {
    device_id: "device-a",
    apns_token: "token-a",
    apns_environment: "production",
    festival_enabled: 1,
    festival_regions: "[]",
    festival_categories: "[]",
    local_event_enabled: 1,
    local_event_regions: "[]",
    local_event_categories: "[]",
    quiet_hours_enabled: 0,
    quiet_start_hour: 22,
    quiet_end_hour: 8,
    ...overrides,
  };
}

function okSender(): ApnsSender & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({ ok: true, status: 200 }));
  return { send } as unknown as ApnsSender & { send: ReturnType<typeof vi.fn> };
}

// 2026-10-01 09:00 KST = 2026-10-01T00:00:00Z
const OCT_1 = new Date("2026-10-01T00:00:00Z");

describe("날짜 계산", () => {
  it("KST 기준 오늘 날짜를 쓴다", () => {
    // UTC 23시는 KST로 이미 다음 날이다.
    expect(seoulDayString(new Date("2026-09-30T23:00:00Z"))).toBe("2026-10-01");
  });

  it("D-30 / D-7 / D-1 목표 시작일은 구간이 아니라 정확히 그 날짜다", () => {
    expect(targetDates("2026-10-01")).toEqual([
      { type: "D30", date: "2026-10-31" },
      { type: "D7", date: "2026-10-08" },
      { type: "D1", date: "2026-10-02" },
    ]);
  });
});

describe("planUpcomingNotifications", () => {
  it("오늘+30일에 시작하면 D30 대상이고, +29일이면 아니다", async () => {
    const hit = fakeDb({
      festivals: [festivalRow({ start_date: addDays("2026-10-01", 30) })],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(hit.db, OCT_1);
    expect([...hit.sends.values()].map((row) => row.notification_type)).toEqual(["D30"]);

    const miss = fakeDb({
      festivals: [festivalRow({ start_date: addDays("2026-10-01", 29) })],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(miss.db, OCT_1);
    expect(miss.sends.size).toBe(0);
  });

  it("+7일은 D7, +6일은 대상이 아니다", async () => {
    const hit = fakeDb({
      festivals: [festivalRow({ start_date: addDays("2026-10-01", 7) })],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(hit.db, OCT_1);
    expect([...hit.sends.values()].map((row) => row.notification_type)).toEqual(["D7"]);

    const miss = fakeDb({
      festivals: [festivalRow({ start_date: addDays("2026-10-01", 6) })],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(miss.db, OCT_1);
    expect(miss.sends.size).toBe(0);
  });

  it("+1일은 D1, 오늘 시작은 대상이 아니다", async () => {
    const hit = fakeDb({
      festivals: [festivalRow({ start_date: addDays("2026-10-01", 1) })],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(hit.db, OCT_1);
    expect([...hit.sends.values()].map((row) => row.notification_type)).toEqual(["D1"]);

    const miss = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-01" })],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(miss.db, OCT_1);
    expect(miss.sends.size).toBe(0);
  });

  it("관심 지역이 없으면 전국 전체가 대상이다", async () => {
    const { db, sends } = fakeDb({
      festivals: [
        festivalRow({ id: "f1", address: "제주특별자치도 서귀포시", start_date: "2026-10-31" }),
        festivalRow({ id: "f2", address: "강원특별자치도 고성군", start_date: "2026-10-31" }),
      ],
      devices: [deviceRow({ festival_regions: "[]" })],
    });
    await planUpcomingNotifications(db, OCT_1);
    expect(sends.size).toBe(2);
  });

  it("서울을 고르면 서울 행사만 대상이다", async () => {
    const { db, sends } = fakeDb({
      festivals: [
        festivalRow({ id: "f1", address: "서울특별시 마포구", start_date: "2026-10-31" }),
        festivalRow({ id: "f2", address: "부산광역시 해운대구", start_date: "2026-10-31" }),
      ],
      devices: [deviceRow({ festival_regions: JSON.stringify(["서울"]) })],
    });
    await planUpcomingNotifications(db, OCT_1);
    expect([...sends.values()].map((row) => row.event_id)).toEqual(["f1"]);
  });

  it("인천 연수구를 고르면 인천의 다른 구는 빠지고, 서울 중구와 부산 중구도 갈린다", async () => {
    const yeonsu = fakeDb({
      festivals: [
        festivalRow({ id: "f1", address: "인천광역시 연수구 송도동", start_date: "2026-10-31" }),
        festivalRow({ id: "f2", address: "인천광역시 중구 신흥동", start_date: "2026-10-31" }),
      ],
      devices: [deviceRow({ festival_regions: JSON.stringify(["인천|연수구"]) })],
    });
    await planUpcomingNotifications(yeonsu.db, OCT_1);
    expect([...yeonsu.sends.values()].map((row) => row.event_id)).toEqual(["f1"]);

    const junggu = fakeDb({
      festivals: [
        festivalRow({ id: "f1", address: "서울특별시 중구 필동", start_date: "2026-10-31" }),
        festivalRow({ id: "f2", address: "부산광역시 중구 남포동", start_date: "2026-10-31" }),
      ],
      devices: [deviceRow({ festival_regions: JSON.stringify(["서울|중구"]) })],
    });
    await planUpcomingNotifications(junggu.db, OCT_1);
    expect([...junggu.sends.values()].map((row) => row.event_id)).toEqual(["f1"]);
  });

  it("카테고리가 비면 전체, 고르면 그 카테고리만", async () => {
    const festivals = [
      festivalRow({ id: "f1", primary_category: "music_performance", start_date: "2026-10-31" }),
      festivalRow({ id: "f2", primary_category: "food_festival", start_date: "2026-10-31" }),
    ];
    const all = fakeDb({ festivals, devices: [deviceRow({})] });
    await planUpcomingNotifications(all.db, OCT_1);
    expect(all.sends.size).toBe(2);

    const music = fakeDb({
      festivals,
      devices: [deviceRow({ festival_categories: JSON.stringify(["music_performance"]) })],
    });
    await planUpcomingNotifications(music.db, OCT_1);
    expect([...music.sends.values()].map((row) => row.event_id)).toEqual(["f1"]);
  });

  it("가게 로컬 이벤트도 시작일이 있으면 D30/D7/D1 대상이다", async () => {
    const { db, sends } = fakeDb({
      localEvents: [
        {
          id: "le1",
          title: "카페 오픈 이벤트",
          address: "서울특별시 마포구 연남동",
          start_date: "2026-10-31",
          primary_category: null,
        },
      ],
      devices: [deviceRow({})],
    });
    await planUpcomingNotifications(db, OCT_1);
    expect([...sends.values()].map((row) => row.event_kind)).toEqual(["local_event"]);
  });

  it("알림이 꺼진 기기는 대상에서 빠진다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({ festival_enabled: 0, local_event_enabled: 0 })],
    });
    await planUpcomingNotifications(db, OCT_1);
    expect(sends.size).toBe(0);
  });
});

describe("dispatchPendingNotifications", () => {
  it("cron이 두 번 돌아도 같은 (기기, 행사, 종류)는 한 번만 발송된다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    const sender = okSender();

    await planUpcomingNotifications(db, OCT_1);
    await dispatchPendingNotifications(db, sender, { now: OCT_1 });
    await planUpcomingNotifications(db, OCT_1);
    await dispatchPendingNotifications(db, sender, { now: OCT_1 });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sends.size).toBe(1);
  });

  it("D30 발송 후 D-7 시점이 되면 D7이 따로 나간다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    const sender = okSender();

    await planUpcomingNotifications(db, OCT_1);
    await dispatchPendingNotifications(db, sender, { now: OCT_1 });

    const oct24 = new Date("2026-10-24T00:00:00Z");
    await planUpcomingNotifications(db, oct24);
    await dispatchPendingNotifications(db, sender, { now: oct24 });

    expect(sender.send).toHaveBeenCalledTimes(2);
    expect([...sends.values()].map((row) => row.notification_type).sort()).toEqual([
      "D30",
      "D7",
    ]);
  });

  it("한 회차 상한에 걸린 대기 항목은 버려지지 않고 다음 회차에 나간다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ id: "f1", start_date: "2026-10-31" })],
      devices: [
        deviceRow({ device_id: "d1", apns_token: "t1" }),
        deviceRow({ device_id: "d2", apns_token: "t2" }),
      ],
    });
    const sender = okSender();

    await planUpcomingNotifications(db, OCT_1);
    const first = await dispatchPendingNotifications(db, sender, {
      now: OCT_1,
      maxPushes: 1,
    });
    expect(first.sent).toBe(1);
    expect([...sends.values()].filter((row) => row.sent_at === null)).toHaveLength(1);

    const second = await dispatchPendingNotifications(db, sender, { now: OCT_1 });
    expect(second.sent).toBe(1);
    expect([...sends.values()].filter((row) => row.sent_at === null)).toHaveLength(0);
  });

  it("여러 건이 쌓이면 묶음 알림 하나로 전부 처리한다", async () => {
    const { db, sends } = fakeDb({
      festivals: [
        festivalRow({ id: "f1", title: "축제 하나", start_date: "2026-10-31" }),
        festivalRow({ id: "f2", title: "축제 둘", start_date: "2026-10-31" }),
        festivalRow({ id: "f3", title: "축제 셋", start_date: "2026-10-31" }),
      ],
      devices: [deviceRow({})],
    });
    const sender = okSender();

    await planUpcomingNotifications(db, OCT_1);
    const result = await dispatchPendingNotifications(db, sender, { now: OCT_1 });

    expect(result.sent).toBe(1);
    expect(result.rowsMarked).toBe(3);
    expect([...sends.values()].every((row) => row.sent_at !== null)).toBe(true);
  });

  it("방해 금지 시간대의 기기는 건너뛰고 대기 행을 남긴다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [
        deviceRow({ quiet_hours_enabled: 1, quiet_start_hour: 22, quiet_end_hour: 8 }),
      ],
    });
    const sender = okSender();
    await planUpcomingNotifications(db, OCT_1);
    // 2026-10-01T18:00:00Z = KST 03:00
    const result = await dispatchPendingNotifications(db, sender, {
      now: new Date("2026-10-01T18:00:00Z"),
    });
    expect(result.skippedQuietHours).toBe(1);
    expect(sender.send).not.toHaveBeenCalled();
    expect([...sends.values()][0].sent_at).toBeNull();
  });

  it("만료된 토큰이면 토큰만 비우고 대기 행은 남긴다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    const sender = {
      send: vi.fn(async () => ({ ok: false, status: 410, reason: "Unregistered" })),
    } as unknown as ApnsSender;

    await planUpcomingNotifications(db, OCT_1);
    const result = await dispatchPendingNotifications(db, sender, { now: OCT_1 });
    expect(result.clearedTokens).toBe(1);
    expect([...sends.values()][0].sent_at).toBeNull();
  });
});

describe("알림 문구", () => {
  it("한 건이면 행사 상세, 여러 건이면 묶음", () => {
    const row = {
      device_id: "d",
      event_id: "f1",
      notification_type: "D30" as const,
      event_kind: "festival" as const,
      event_title: "송도 불꽃축제",
      event_start_date: "2026-10-31",
      attempts: 0,
    };
    const single = buildNotification("D30", [row]);
    expect(single.title).toBe("🎪 송도 불꽃축제");
    expect(single.body).toBe("30일 남았어요 · 10월 31일 시작");
    expect(single.data).toEqual({
      eventKind: "festival",
      eventId: "f1",
      notificationType: "D30",
    });

    const digest = buildNotification("D1", [row, { ...row, event_id: "f2" }, { ...row, event_id: "f3" }]);
    expect(digest.title).toBe("🎪 다가오는 행사 3건");
    expect(digest.data.eventKind).toBe("digest");
  });
});

describe("isWithinQuietHours", () => {
  it("자정을 넘는 구간도 처리한다", () => {
    expect(isWithinQuietHours(3, 22, 8)).toBe(true);
    expect(isWithinQuietHours(23, 22, 8)).toBe(true);
    expect(isWithinQuietHours(12, 22, 8)).toBe(false);
    expect(isWithinQuietHours(12, 8, 22)).toBe(true);
    expect(isWithinQuietHours(12, 12, 12)).toBe(false);
  });
});
