import { describe, expect, it } from "vitest";
import {
  LOCAL_EVENT_CHUNK_COUNT,
  currentLocalEventChunkIndex,
  plannedJobs,
  type BackgroundJob,
} from "../src/jobs.js";
import { currentDiscoveryChunkIndex } from "../src/discoverySchedule.js";
import { CITY_FESTIVAL_SITES } from "../src/cityFestivalSites.js";
import {
  CITY_FESTIVAL_CHUNK_SIZE,
  currentCityFestivalChunkIndex,
  sitesForChunk,
} from "../src/cityFestivalSchedule.js";

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

  it("로컬 이벤트는 예전 `15 * * * *`와 같은 24회", () => {
    expect(counts["local-events"]).toBe(24);
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

  it("city 사이트는 하루 한 청크만 팬아웃한다", () => {
    expect(counts["city-festival-site"]).toBeGreaterThan(0);
    expect(counts["city-festival-site"]).toBeLessThanOrEqual(CITY_FESTIVAL_CHUNK_SIZE);
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

  it("로컬 이벤트 청크 인덱스가 3시간 로테이션을 따른다", () => {
    const at = new Date(DAY_START + 15 * MINUTE + 9 * 60 * MINUTE);
    const job = plannedJobs(at).find((j) => j.type === "local-events");
    expect(job).toEqual({
      type: "local-events",
      chunkIndex: currentLocalEventChunkIndex(at, LOCAL_EVENT_CHUNK_COUNT),
    });
  });

  it("city 팬아웃은 그날 청크의 사이트를 하나씩 낸다", () => {
    const at = new Date(DAY_START + 4 * 60 * MINUTE + 21 * MINUTE);
    const chunkIndex = currentCityFestivalChunkIndex(at, CITY_FESTIVAL_SITES.length);
    const expected = sitesForChunk(CITY_FESTIVAL_SITES, chunkIndex, CITY_FESTIVAL_CHUNK_SIZE).map(
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
