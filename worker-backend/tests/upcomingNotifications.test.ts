import { describe, expect, it, vi } from "vitest";
import type { ApnsSender } from "../src/apns.js";
import { registerNotificationDevice } from "../src/notificationRegistration.js";
import {
  addDays,
  buildNotification,
  CLAIM_TTL_MS,
  dispatchPendingNotifications,
  isWithinQuietHours,
  planUpcomingNotifications,
  seoulDayString,
  targetDates,
  upcomingCollapseId,
} from "../src/upcomingNotifications.js";

type Row = Record<string, unknown>;

/**
 * notification_sends / notification_devices 상태를 실제로 들고 있는 D1 흉내.
 * 중복 발송은 "행이 어떤 상태였나"에 달려 있어서 상태 없는 mock으로는 재현되지 않는다.
 * 0025의 부분 UNIQUE 인덱스도 여기서 흉내 낸다 — 소유권 이전이 없으면 등록이 실패해야 한다.
 */
function fakeDb(seed: {
  festivals?: Row[];
  localEvents?: Row[];
  devices?: Row[];
}) {
  const festivals = seed.festivals ?? [];
  const localEvents = seed.localEvents ?? [];
  const devices = seed.devices ?? [];
  const sends = new Map<string, Row>();
  const key = (row: Row) =>
    `${row.device_id}|${row.event_id}|${row.notification_type}`;

  const exec = (sql: string, args: unknown[]): { results: Row[] } => {
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

    // ---- notification_devices
    if (sql.includes("SELECT device_id FROM notification_devices")) {
      const [environment, token, deviceId] = args as string[];
      return {
        results: devices
          .filter(
            (row) =>
              row.apns_environment === environment &&
              row.apns_token === token &&
              row.device_id !== deviceId,
          )
          .map((row) => ({ device_id: row.device_id })),
      };
    }
    if (sql.includes("INSERT INTO notification_devices")) {
      const [
        device_id,
        apns_token,
        apns_environment,
        festival_enabled,
        festival_regions,
        festival_categories,
        local_event_enabled,
        local_event_regions,
        local_event_categories,
        quiet_hours_enabled,
        quiet_start_hour,
        quiet_end_hour,
        created_at,
        updated_at,
      ] = args;
      // 0025 부분 UNIQUE 인덱스: 같은 (환경, 토큰)을 두 device가 들 수 없다.
      if (
        apns_token &&
        devices.some(
          (row) =>
            row.device_id !== device_id &&
            row.apns_environment === apns_environment &&
            row.apns_token === apns_token,
        )
      ) {
        throw new Error(
          "UNIQUE constraint failed: index 'idx_notification_devices_token'",
        );
      }
      const next: Row = {
        device_id,
        apns_token,
        apns_environment,
        festival_enabled,
        festival_regions,
        festival_categories,
        local_event_enabled,
        local_event_regions,
        local_event_categories,
        quiet_hours_enabled,
        quiet_start_hour,
        quiet_end_hour,
        created_at,
        updated_at,
      };
      const existing = devices.find((row) => row.device_id === device_id);
      if (existing) {
        Object.assign(existing, next, {
          apns_token: apns_token ?? existing.apns_token,
          created_at: existing.created_at,
        });
      } else {
        devices.push(next);
      }
      return { results: [] };
    }
    if (sql.includes("SELECT * FROM notification_devices")) {
      return {
        results: devices.filter(
          (row) =>
            row.apns_token &&
            (row.festival_enabled === 1 || row.local_event_enabled === 1),
        ),
      };
    }
    if (sql.includes("UPDATE notification_devices SET apns_token = NULL")) {
      const deviceId = args[1] as string;
      const device = devices.find((row) => row.device_id === deviceId);
      if (device) device.apns_token = null;
      return { results: [] };
    }

    // ---- notification_sends
    if (
      sql.includes("INSERT OR IGNORE INTO notification_sends") &&
      sql.includes("SELECT")
    ) {
      const [toDeviceId, fromDeviceId] = args as string[];
      for (const row of [...sends.values()]) {
        if (row.device_id !== fromDeviceId) continue;
        const moved = { ...row, device_id: toDeviceId };
        if (!sends.has(key(moved))) sends.set(key(moved), moved);
      }
      return { results: [] };
    }
    if (sql.includes("INSERT OR IGNORE INTO notification_sends")) {
      const [
        device_id,
        event_id,
        notification_type,
        event_kind,
        event_title,
        event_start_date,
        planned_at,
      ] = args as string[];
      const row: Row = {
        device_id,
        event_id,
        notification_type,
        event_kind,
        event_title,
        event_start_date,
        planned_at,
        sent_at: null,
        attempts: 0,
        last_error: null,
        claim_id: null,
        claimed_at: null,
      };
      if (!sends.has(key(row))) sends.set(key(row), row);
      return { results: [] };
    }
    if (sql.includes("SET sent_at = (")) {
      const [fromDeviceId, toDeviceId] = args as string[];
      for (const row of sends.values()) {
        if (row.device_id !== toDeviceId || row.sent_at !== null) continue;
        const old = sends.get(
          `${fromDeviceId}|${row.event_id}|${row.notification_type}`,
        );
        if (old && old.sent_at !== null) row.sent_at = old.sent_at;
      }
      return { results: [] };
    }
    if (sql.includes("DELETE FROM notification_sends")) {
      const [deviceId] = args as string[];
      for (const [mapKey, row] of [...sends.entries()]) {
        if (row.device_id === deviceId) sends.delete(mapKey);
      }
      return { results: [] };
    }
    if (sql.includes("SET claim_id = ?, claimed_at = ?")) {
      const [claimId, claimedAt, type, staleBefore, ...deviceIds] = args as string[];
      for (const row of sends.values()) {
        if (row.notification_type !== type) continue;
        if (row.sent_at !== null) continue;
        if (!deviceIds.includes(row.device_id as string)) continue;
        if (row.claim_id !== null && (row.claimed_at as string) > staleBefore) continue;
        row.claim_id = claimId;
        row.claimed_at = claimedAt;
      }
      return { results: [] };
    }
    if (sql.includes("SET sent_at = ?, attempts = attempts + 1, claim_id = NULL")) {
      const [sent_at, device_id, event_id, notification_type, claimId] =
        args as string[];
      const row = sends.get(`${device_id}|${event_id}|${notification_type}`);
      if (row && row.claim_id === claimId) {
        row.sent_at = sent_at;
        row.attempts = (row.attempts as number) + 1;
        row.claim_id = null;
      }
      return { results: [] };
    }
    if (sql.includes("claim_id = NULL, claimed_at = NULL")) {
      const [last_error, device_id, event_id, notification_type, claimId] =
        args as string[];
      const row = sends.get(`${device_id}|${event_id}|${notification_type}`);
      if (row && row.claim_id === claimId) {
        row.attempts = (row.attempts as number) + 1;
        row.last_error = last_error;
        row.claim_id = null;
        row.claimed_at = null;
      }
      return { results: [] };
    }
    if (sql.includes("SET attempts = attempts + 1, last_error = ?")) {
      const [last_error, device_id, event_id, notification_type, claimId] =
        args as string[];
      const row = sends.get(`${device_id}|${event_id}|${notification_type}`);
      if (row && row.claim_id === claimId) {
        row.attempts = (row.attempts as number) + 1;
        row.last_error = last_error;
      }
      return { results: [] };
    }
    if (sql.includes("SELECT DISTINCT device_id, notification_type")) {
      const [staleBefore] = args as string[];
      const seen = new Set<string>();
      const results: Row[] = [];
      const ordered = [...sends.values()].sort((a, b) =>
        `${a.device_id}|${a.notification_type}`.localeCompare(
          `${b.device_id}|${b.notification_type}`,
        ),
      );
      for (const row of ordered) {
        if (row.sent_at !== null) continue;
        if (row.claim_id !== null && (row.claimed_at as string) > staleBefore) continue;
        const pairKey = `${row.device_id}|${row.notification_type}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        results.push({
          device_id: row.device_id,
          notification_type: row.notification_type,
        });
      }
      return { results };
    }
    if (sql.includes("FROM notification_sends")) {
      const [type, claimId, ...deviceIds] = args as string[];
      return {
        results: [...sends.values()]
          .filter(
            (row) =>
              row.notification_type === type &&
              row.sent_at === null &&
              row.claim_id === claimId &&
              deviceIds.includes(row.device_id as string),
          )
          .sort((a, b) =>
            `${a.event_start_date}|${a.event_id}`.localeCompare(
              `${b.event_start_date}|${b.event_id}`,
            ),
          )
          .map((row) => ({ ...row })),
      };
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

  return { db, sends, devices };
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
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function okSender(): ApnsSender & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({ ok: true, status: 200 }));
  return { send } as unknown as ApnsSender & { send: ReturnType<typeof vi.fn> };
}

function registrationInput(overrides: Partial<Parameters<typeof registerNotificationDevice>[1]> = {}) {
  return {
    deviceId: "device-a",
    apnsToken: "token-a",
    apnsEnvironment: "production",
    festival: { enabled: true, regions: [], categories: [] },
    localEvent: { enabled: true, regions: [], categories: [] },
    quietHours: { enabled: false, startHour: 22, endHour: 8 },
    ...overrides,
  };
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

describe("한 물리 기기에 두 번 가지 않는다", () => {
  it("A. 같은 APNs 토큰을 든 device_id가 셋이어도 push는 한 번이다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ id: "f1", start_date: "2026-10-31" })],
      devices: [
        deviceRow({ device_id: "old-1", apns_token: "token-x" }),
        deviceRow({ device_id: "old-2", apns_token: "token-x" }),
        deviceRow({ device_id: "new-3", apns_token: "token-x" }),
      ],
    });
    const sender = okSender();

    await planUpcomingNotifications(db, OCT_1);
    // 계획은 device 단위라 세 행이 생긴다. 발송은 물리 대상 단위라 한 번이어야 한다.
    expect(sends.size).toBe(3);

    const result = await dispatchPendingNotifications(db, sender, { now: OCT_1 });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    expect(result.rowsMarked).toBe(3);
    // 같은 축제가 "3건"짜리 묶음으로 둔갑하지 않는다.
    expect(sender.send.mock.calls[0][2].title).toBe("🎪 테스트 축제 f1");
    expect([...sends.values()].every((row) => row.sent_at !== null)).toBe(true);
  });

  it("B. 같은 토큰으로 새 device가 등록하면 옛 device는 토큰을 잃는다", async () => {
    const { db, devices } = fakeDb({
      devices: [deviceRow({ device_id: "old-1", apns_token: "token-x" })],
    });

    const { transferredFrom } = await registerNotificationDevice(
      db,
      registrationInput({ deviceId: "new-2", apnsToken: "token-x" }),
      "2026-10-01T00:00:00.000Z",
    );

    expect(transferredFrom).toEqual(["old-1"]);
    expect(devices.find((row) => row.device_id === "old-1")?.apns_token).toBeNull();
    expect(devices.find((row) => row.device_id === "new-2")?.apns_token).toBe("token-x");
    // 같은 (환경, 토큰)을 든 활성 기기는 언제나 하나뿐이다.
    expect(devices.filter((row) => row.apns_token === "token-x")).toHaveLength(1);
  });

  it("C. 재설치로 device id가 바뀌어도 이미 보낸 알림은 다시 나가지 않는다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ id: "f1", start_date: "2026-10-31" })],
      devices: [deviceRow({ device_id: "old-1", apns_token: "token-x" })],
    });
    const sender = okSender();

    await planUpcomingNotifications(db, OCT_1);
    await dispatchPendingNotifications(db, sender, { now: OCT_1 });
    expect(sender.send).toHaveBeenCalledTimes(1);

    // 앱 재설치: device id는 새로 생겼지만 APNs 토큰은 같다.
    await registerNotificationDevice(
      db,
      registrationInput({ deviceId: "new-2", apnsToken: "token-x" }),
      "2026-10-01T01:00:00.000Z",
    );

    await planUpcomingNotifications(db, OCT_1);
    await dispatchPendingNotifications(db, sender, { now: OCT_1 });

    expect(sender.send).toHaveBeenCalledTimes(1);
    const rows = [...sends.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].device_id).toBe("new-2");
    expect(rows[0].sent_at).not.toBeNull();
  });

  it("D. 두 발송 회차가 실제로 겹쳐도 한 번만 나간다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ id: "f1", start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    const sender = okSender();

    // 두 회차가 "보낼 것 있나" 조회까지 모두 마친 뒤에야 선점 UPDATE가 실행되도록
    // 첫 선점을 붙잡아 둔다. 이게 실제로 겹치는 구간이다 — 순차 호출로는 재현되지 않는다.
    let releaseFirstClaim: () => void = () => {};
    const firstClaimBlocked = new Promise<void>((resolve) => {
      let gateUsed = false;
      const gate = new Promise<void>((r) => (releaseFirstClaim = r));
      const inner = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        const statement = inner(sql);
        if (!sql.includes("SET claim_id = ?, claimed_at = ?")) return statement;
        return {
          ...statement,
          bind: (...args: unknown[]) => {
            const bound = statement.bind(...args);
            return {
              ...bound,
              run: async () => {
                if (!gateUsed) {
                  gateUsed = true;
                  resolve();
                  await gate;
                }
                return bound.run();
              },
            };
          },
        };
      };
    });

    await planUpcomingNotifications(db, OCT_1);

    const first = dispatchPendingNotifications(db, sender, {
      now: OCT_1,
      claimId: "cycle-A",
    });
    await firstClaimBlocked;
    // 이 시점에 두 번째 회차가 들어온다. 아직 아무도 선점하지 못한 상태다.
    const second = await dispatchPendingNotifications(db, sender, {
      now: OCT_1,
      claimId: "cycle-B",
    });
    releaseFirstClaim();
    const firstResult = await first;

    // 둘 중 하나만 이긴다. 진 쪽은 잡은 행이 0이라 아무것도 보내지 않는다.
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(firstResult.sent + second.sent).toBe(1);
    expect(firstResult.skippedClaimed + second.skippedClaimed).toBe(1);
    const row = [...sends.values()][0];
    expect(row.sent_at).not.toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("E. APNs 200이면 잡은 행 전부가 발송 완료가 된다", async () => {
    const { db, sends } = fakeDb({
      festivals: [
        festivalRow({ id: "f1", title: "축제 하나", start_date: "2026-10-31" }),
        festivalRow({ id: "f2", title: "축제 둘", start_date: "2026-10-31" }),
      ],
      devices: [deviceRow({})],
    });
    const sender = okSender();
    await planUpcomingNotifications(db, OCT_1);
    const result = await dispatchPendingNotifications(db, sender, { now: OCT_1 });

    expect(result.sent).toBe(1);
    expect(result.rowsMarked).toBe(2);
    expect([...sends.values()].every((row) => row.sent_at !== null)).toBe(true);
    expect([...sends.values()].every((row) => row.claim_id === null)).toBe(true);
  });

  it("F. 400 BadDeviceToken은 토큰을 지우고, 500은 선점을 풀어 다음 회차에 재시도한다", async () => {
    const badToken = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    const badSender = {
      send: vi.fn(async () => ({ ok: false, status: 400, reason: "BadDeviceToken" })),
    } as unknown as ApnsSender;
    await planUpcomingNotifications(badToken.db, OCT_1);
    const badResult = await dispatchPendingNotifications(badToken.db, badSender, {
      now: OCT_1,
    });
    expect(badResult.clearedTokens).toBe(1);
    expect(badToken.devices[0].apns_token).toBeNull();
    expect([...badToken.sends.values()][0].sent_at).toBeNull();

    const serverError = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    let calls = 0;
    const flakySender = {
      send: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, status: 500, reason: "InternalServerError" }
          : { ok: true, status: 200 };
      }),
    } as unknown as ApnsSender;
    await planUpcomingNotifications(serverError.db, OCT_1);
    const failed = await dispatchPendingNotifications(serverError.db, flakySender, {
      now: OCT_1,
      claimId: "cycle-A",
    });
    expect(failed.failed).toBe(1);
    // 명시적 거절이므로 선점을 풀어 둔다 — 다음 회차가 바로 다시 잡는다.
    expect([...serverError.sends.values()][0].claim_id).toBeNull();
    expect(serverError.devices[0].apns_token).toBe("token-a");

    const retried = await dispatchPendingNotifications(serverError.db, flakySender, {
      now: OCT_1,
      claimId: "cycle-B",
    });
    expect(retried.sent).toBe(1);
    expect([...serverError.sends.values()][0].sent_at).not.toBeNull();
  });

  it("G. 응답을 못 받으면 선점을 붙잡아 두고 TTL이 지나야 다시 시도한다", async () => {
    const { db, sends } = fakeDb({
      festivals: [festivalRow({ start_date: "2026-10-31" })],
      devices: [deviceRow({})],
    });
    let calls = 0;
    const sender = {
      send: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("network timeout");
        return { ok: true, status: 200 };
      }),
    } as unknown as ApnsSender;

    await planUpcomingNotifications(db, OCT_1);
    const unknown = await dispatchPendingNotifications(db, sender, {
      now: OCT_1,
      claimId: "cycle-A",
    });
    expect(unknown.deliveryUnknown).toBe(1);
    const row = [...sends.values()][0];
    expect(row.sent_at).toBeNull();
    expect(row.claim_id).toBe("cycle-A");
    expect(String(row.last_error)).toContain("delivery_unknown");

    // 바로 다음 회차는 손대지 않는다. 애플이 이미 받았을 수 있기 때문이다.
    const immediate = await dispatchPendingNotifications(db, sender, {
      now: new Date(OCT_1.getTime() + 60_000),
      claimId: "cycle-B",
    });
    expect(immediate.sent).toBe(0);
    expect(sender.send).toHaveBeenCalledTimes(1);

    // TTL이 지나면 그때 한 번 더 시도한다.
    const afterTtl = await dispatchPendingNotifications(db, sender, {
      now: new Date(OCT_1.getTime() + CLAIM_TTL_MS + 60_000),
      claimId: "cycle-C",
    });
    expect(afterTtl.sent).toBe(1);
  });

  it("H. collapse id는 같은 논리적 알림이면 항상 같고 64바이트를 넘지 않는다", () => {
    const row = {
      device_id: "d",
      event_id: "f1",
      notification_type: "D7" as const,
      event_kind: "festival" as const,
      event_title: "송도 불꽃축제",
      event_start_date: "2026-10-31",
      attempts: 0,
    };
    expect(upcomingCollapseId("D7", [row], "2026-10-24")).toBe("up-D7-festival-f1");
    expect(upcomingCollapseId("D7", [row], "2026-10-25")).toBe("up-D7-festival-f1");

    const digest = [row, { ...row, event_id: "f2" }];
    expect(upcomingCollapseId("D7", digest, "2026-10-24")).toBe("up-D7-digest-2026-10-24");
    // 묶음의 정체성은 대상 날짜다. 날짜가 다르면 다른 알림이다.
    expect(upcomingCollapseId("D7", digest, "2026-10-25")).not.toBe(
      upcomingCollapseId("D7", digest, "2026-10-24"),
    );

    const longId = { ...row, event_id: "kopis:".padEnd(200, "x") };
    const hashed = upcomingCollapseId("D30", [longId], "2026-10-24");
    expect(new TextEncoder().encode(hashed).length).toBeLessThanOrEqual(64);
    expect(hashed).toBe(upcomingCollapseId("D30", [longId], "2026-10-24"));
  });
});
