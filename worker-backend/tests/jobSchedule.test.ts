import { describe, expect, it } from "vitest";
import {
  DAILY_SLACK_REPORT_CRON,
  DISPATCH_CRON,
  REALTIME_PARKING_CRON,
  SNAPSHOT_RECOVERY_CRON,
  plannedJobs,
  type BackgroundJob,
} from "../src/jobs.js";
import { currentDiscoveryChunkIndex } from "../src/discoverySchedule.js";
import { CITY_FESTIVAL_SITES } from "../src/cityFestivalSites.js";
import { CITY_FESTIVAL_SITES_PER_HOUR, sitesForHour } from "../src/cityFestivalSchedule.js";
import { MAX_DAILY_SNAPSHOT_MESSAGES } from "../src/discoverySnapshot.js";

const DAY_START = Date.parse("2026-09-10T00:00:00.000Z");
const MINUTE = 60 * 1000;

/** 하루(1,440분)를 분 단위로 훑으며 종류별 메시지 수를 센다. */
function dailyCounts(dayStart = DAY_START): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < 1440; i++) {
    for (const job of plannedJobs(new Date(dayStart + i * MINUTE))) {
      counts[job.type] = (counts[job.type] ?? 0) + 1;
    }
  }
  return counts;
}

describe("plannedJobs 하루 빈도", () => {
  const counts = dailyCounts();

  // 예전 `*/9` cron은 시간당 7회(0,9,18,27,36,45,54분) 돌았다.
  it("discovery-chunk는 예전 */9 cron과 같은 168회", () => {
    expect(counts["discovery-chunk"]).toBe(168);
  });

  // 예전 `*/5` cron 288회를 네 갈래가 나눠 갖는다.
  it("backfill 네 종류가 288회를 고르게 나눈다", () => {
    expect(counts["tagging"]).toBe(72);
    expect(counts["fee-backfill"]).toBe(72);
    expect(counts["geocode-backfill"]).toBe(72);
    expect(counts["image-backfill"]).toBe(72);
  });

  it("program-select는 10분마다 144회", () => {
    expect(counts["program-select"]).toBe(144);
  });

  // 정각은 계획만 넣는다. 그 회차의 발송은 계획 job이 끝난 뒤 스스로 넣는다.
  it("알림 계획 24회, 스케줄러가 넣는 발송 24회", () => {
    expect(counts["notification-plan"]).toBe(24);
    expect(counts["notification-dispatch"]).toBe(24);
  });

  it("자동 로컬 이벤트 크롤링 작업을 만들지 않는다", () => {
    expect(counts["local-events"]).toBeUndefined();
  });

  it("보관 정리는 하루 한 번씩", () => {
    expect(counts["prune-sync-runs"]).toBe(1);
    expect(counts["prune-analytics"]).toBe(1);
  });

  // 예전에는 Promise.all로 한 invocation에서 둘을 같이 돌렸다.
  it("agent 둘은 예전 `30 */3 * * *`와 같은 8회씩, 각각 별도 메시지", () => {
    expect(counts["agent-head"]).toBe(8);
    expect(counts["agent-image"]).toBe(8);
  });

  it("AKEI는 월별 1페이지씩 하루 3건", () => {
    expect(counts["akei-page"]).toBe(3);
  });

  it("city 사이트는 매시간 3개씩 하루 72개만 팬아웃한다", () => {
    expect(counts["city-festival-site"]).toBe(24 * CITY_FESTIVAL_SITES_PER_HOUR);
  });

  it("전파 작업과 스냅샷까지 합산해 일일 Queue 재시도 여유를 보존한다", () => {
    const direct = Object.values(counts).reduce((a, b) => a + b, 0);
    const deferredDispatch = 24, additionalAkeiPages = 27;
    const programChildren = 144 * 4 * 3; // page + subpage + AI
    const totalOps = (direct + deferredDispatch + additionalAkeiPages + programChildren + MAX_DAILY_SNAPSHOT_MESSAGES) * 3;
    expect(totalOps).toBe(9510);
    expect(10000 - totalOps).toBeGreaterThanOrEqual(490);
  });
});

describe("독립 Cron 계약", () => {
  it("계정 상한 안에서 dispatcher와 무거운 작업을 서로 다른 네 trigger로 격리한다", () => {
    expect(new Set([
      DISPATCH_CRON, REALTIME_PARKING_CRON, SNAPSHOT_RECOVERY_CRON, DAILY_SLACK_REPORT_CRON,
    ])).toEqual(new Set([
      "* * * * *", "*/4 * * * *", "2-57/5 * * * *", "0,10,20 11 * * *",
    ]));
  });
});

describe("plannedJobs 중복 방지", () => {
  it("한 회차에 같은 job이 두 번 들어가지 않는다", () => {
    for (let i = 0; i < 1440; i++) {
      const jobs = plannedJobs(new Date(DAY_START + i * MINUTE));
      const keys = jobs.map((job) => JSON.stringify(job));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("계획과 발송이 같은 회차에 함께 들어가지 않는다", () => {
    for (let i = 0; i < 1440; i++) {
      const types = plannedJobs(new Date(DAY_START + i * MINUTE)).map((job) => job.type);
      expect(types.includes("notification-plan") && types.includes("notification-dispatch")).toBe(
        false,
      );
    }
  });

  it("스케줄러는 D1을 읽지 않으므로 같은 시각이면 항상 같은 결과다", () => {
    const at = new Date(DAY_START + 21 * MINUTE + 5 * 60 * MINUTE);
    expect(plannedJobs(at)).toEqual(plannedJobs(at));
  });
});

describe("plannedJobs 회차 내용", () => {
  it("discovery 청크 인덱스가 로테이션 헬퍼와 일치한다", () => {
    const at = new Date(DAY_START + 27 * MINUTE);
    const job = plannedJobs(at).find((j) => j.type === "discovery-chunk");
    expect(job).toEqual({ type: "discovery-chunk", chunkIndex: currentDiscoveryChunkIndex(at) });
  });

  it("city 팬아웃은 해당 시간 슬롯의 사이트를 하나씩 낸다", () => {
    const at = new Date(DAY_START + 4 * 60 * MINUTE + 21 * MINUTE);
    const expected = sitesForHour(CITY_FESTIVAL_SITES, at).map(
      (site) => site.siteId,
    );
    const jobs = plannedJobs(at).filter(
      (job): job is Extract<BackgroundJob, { type: "city-festival-site" }> =>
        job.type === "city-festival-site",
    );
    expect(jobs.map((job) => job.siteId)).toEqual(expected);
    expect(new Set(expected).size).toBe(expected.length);
  });

  it("AKEI는 이번 달부터 3개월치 1페이지를 넣는다", () => {
    const at = new Date(DAY_START + 5 * 60 * MINUTE + 21 * MINUTE);
    const jobs = plannedJobs(at).filter((job) => job.type === "akei-page");
    expect(jobs).toEqual([
      { type: "akei-page", year: 2026, month: 9, page: 1 },
      { type: "akei-page", year: 2026, month: 10, page: 1 },
      { type: "akei-page", year: 2026, month: 11, page: 1 },
    ]);
  });

  it("해가 바뀌는 달도 정상적으로 넘어간다", () => {
    const at = new Date(Date.parse("2026-11-20T05:21:00.000Z"));
    const jobs = plannedJobs(at).filter((job) => job.type === "akei-page");
    expect(jobs).toEqual([
      { type: "akei-page", year: 2026, month: 11, page: 1 },
      { type: "akei-page", year: 2026, month: 12, page: 1 },
      { type: "akei-page", year: 2027, month: 1, page: 1 },
    ]);
  });

  it("아무 job도 없는 분이 존재한다 — 매 분 무언가를 돌리지 않는다", () => {
    expect(plannedJobs(new Date(DAY_START + 1 * MINUTE))).toEqual([]);
  });
});
