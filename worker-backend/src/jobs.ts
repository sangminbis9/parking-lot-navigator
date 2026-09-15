import type { Env } from "./index.js";
import { currentDiscoveryChunkIndex } from "./discoverySchedule.js";
import { sitesForHour } from "./cityFestivalSchedule.js";
import { CITY_FESTIVAL_SITES } from "./cityFestivalSites.js";
import { akeiTargetMonths } from "./akeiTradeExpoDiscovery.js";

/**
 * Queue로 넘기는 background job.
 *
 * 설계 기준은 Cloudflare Queues Free 제공량 **10,000 operations/day**다.
 * 문서상 메시지 하나를 배달하는 데 보통 write 1 + read 1 + delete 1 = 3 op가 들고
 * (64KB마다 1 op라 우리 메시지는 전부 1 op 단위), 배치 크기는 op 수를 바꾸지 않는다.
 * 즉 **하루 약 3,333건이 실질 상한**이다. 그래서 CPU가 비싼 작업(프로그램 크롤 HTML
 * 파싱, AKEI cheerio 파싱, city 사이트 스크래핑)만 "메시지 1건 = 작은 작업 1건"으로
 * 쪼개고, 나머지 배치 작업(요금·사진·좌표·태깅)은 회차당 메시지 1건으로 묶는다.
 * 실시간 주차는 아예 Queue를 쓰지 않는다 — 하루 1,920건(= 예산의 58%)이라 감당이 안 돼
 * 스케줄러 invocation 안에서 shard를 직접 돌린다.
 *
 * 예상 메시지/일 (근거는 docs/operations/worker-limits.md):
 *   고정분 816건 — discovery-chunk 168(=7회/시×24) · tagging/fee/geocode/image 72×4=288
 *   · program-select 144 · notification-plan 24 + dispatch 48 · local-events 24
 *   · agent-head/image 16 · city-festival-site 72 · akei-page 최대 30 · prune 2
 *   변동분 — program-page 576(=144회×4건), 그 뒤 subpage/ai 최대 1,152
 *
 *   최악 ≈ 2,544건 ≈ 7,632 ops/day. 스냅샷 650건=1,950 ops 포함 9,582.
 *   현실 ≈ 1,700건 ≈ 5,100 ops/day (한도의 51%)
 *   사장님 즉시 Slack 알림은 정상 시 waitUntil 직송이라 Queue 0건이다.
 *   Slack 실패 때만 메시지 1건(재시도 없는 정상 복구 약 3 ops)을 추가한다.
 *
 * PROGRAM_CRAWL_MAX_ITEMS를 6보다 크게 올리면 재시도 여유가 사라진다 —
 * 그 값이 이 예산에서 가장 민감한 손잡이다.
 */
export type BackgroundJob =
  | import("./discoverySnapshot.js").SnapshotJob
  | { type: "discovery-chunk"; chunkIndex: number }
  | { type: "local-events"; chunkIndex: number }
  | { type: "tagging" }
  | { type: "fee-backfill" }
  | { type: "geocode-backfill" }
  | { type: "image-backfill" }
  | { type: "program-select" }
  | { type: "program-page"; id: string; url: string }
  | { type: "program-subpage"; id: string; url: string }
  | { type: "program-ai"; id: string; url: string }
  | { type: "akei-page"; year: number; month: number; page: number }
  | { type: "city-festival-site"; siteId: string }
  | { type: "agent-head" }
  | { type: "agent-image" }
  | { type: "notification-plan" }
  | { type: "notification-dispatch" }
  | { type: "merchant-event-slack"; eventId: string }
  | { type: "prune-sync-runs" }
  | { type: "prune-analytics" };

/**
 * Queue send는 네트워크 I/O라 CPU를 거의 쓰지 않는다. 스케줄러 invocation이
 * 여러 job을 한 번에 보내도 10ms 예산에 여유가 있다.
 *
 * binding이 없으면(로컬 dev, 테스트) 조용히 넘어간다 — Queue 미설정이 cron 전체를
 * 죽이지 않게 하려는 것이고, 그 환경에서는 admin endpoint로 같은 작업을 돌릴 수 있다.
 */
export async function sendJobs(env: Env, jobs: BackgroundJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const queue = env.BACKGROUND_QUEUE;
  if (!queue) {
    console.warn(`BACKGROUND_QUEUE unbound, dropped ${jobs.length} job(s)`);
    return;
  }
  try {
    if (jobs.length === 1) {
      await queue.send(jobs[0]);
      return;
    }
    await queue.sendBatch(jobs.map((body) => ({ body })));
  } catch (error) {
    console.error("queue send failed", error);
  }
}

/** 로컬 이벤트 청크 수. 3시간마다 한 칸씩 돌아 하루 8칸을 쓴다. */
export const LOCAL_EVENT_CHUNK_COUNT = 12;

export function currentLocalEventChunkIndex(now: Date, chunkCount: number): number {
  if (chunkCount <= 1) return 0;
  const slot = Math.floor(now.getTime() / (3 * 60 * 60 * 1000));
  return ((slot % chunkCount) + chunkCount) % chunkCount;
}

// 직접 I/O를 하는 실시간 주차와 스냅샷 복구는 별도 invocation으로 분리한다.
// 분당 dispatcher가 Queue 전송과 함께 실행하면 한 작업의 CPU 초과가 다른 작업까지
// 중단시키기 때문이다. controller.cron은 wrangler에 적은 문자열을 그대로 제공한다.
export const DISPATCH_CRON = "* * * * *";
export const REALTIME_PARKING_CRON = "*/4 * * * *";
export const SNAPSHOT_RECOVERY_CRON = "2-57/5 * * * *";
// 20:00 KST에 발송하고, 일시 실패 시 20:10/20:20에 R2 중복 방지 후 재시도한다.
export const DAILY_SLACK_REPORT_CRON = "0,10,20 11 * * *";
export const REALTIME_SYNC_CADENCE_MINUTES = 4;

// 이 분에 Queue로 넘길 job 목록. 예전 다섯 cron의 빈도를 분 가드로 재현한다 —
// `*/3`은 `분%3`, `*/9`는 `분%9`, `*/5`는 `분%5`, `15 * * * *`는
// `분===15`, `30 */3 * * *`는 `분===30 && 시%3===0`.
//
// D1을 읽지 않고 시각만 본다. 그래서 테스트가 가짜 시각만으로 전 구간을 훑을 수 있다.
export function plannedJobs(scheduledAt: Date): BackgroundJob[] {
  const minute = scheduledAt.getUTCMinutes();
  const hour = scheduledAt.getUTCHours();
  const jobs: BackgroundJob[] = [];

  if (minute % 9 === 0) {
    jobs.push({ type: "discovery-chunk", chunkIndex: currentDiscoveryChunkIndex(scheduledAt) });
  }

  if (minute % 5 === 0) {
    // 프로그램 크롤이 이 로테이션에서 빠져(자체 10분 슬롯으로 이동) 5칸 → 4칸이 됐다.
    // 분이 아니라 epoch 5분 칸으로 나누는 이유는 한 시간에 5분 슬롯이 12개라
    // `분 % 4`로 나누면 슬롯마다 시간당 횟수가 갈리기 때문이다.
    const slot = Math.floor(scheduledAt.getTime() / 300_000) % 4;
    jobs.push(
      slot === 0
        ? { type: "tagging" }
        : slot === 1
          ? { type: "fee-backfill" }
          : slot === 2
            ? { type: "geocode-backfill" }
            : { type: "image-backfill" },
    );
  }

  // 프로그램 크롤은 선정(D1만)과 페이지 처리(HTML 파싱)를 분리했다.
  // 선정 회차 하나가 최대 PROGRAM_CRAWL_MAX_ITEMS건의 page 메시지를 만든다.
  if (minute % 10 === 0) jobs.push({ type: "program-select" });

  // 계획은 정각에, 발송은 30분마다. 정각 발송은 계획 job이 끝난 뒤 직접 넣는다
  // (Queue는 순서를 보장하지 않으므로 같은 회차에 둘을 함께 넣지 않는다).
  if (minute === 0) jobs.push({ type: "notification-plan" });
  else if (minute % 30 === 0) jobs.push({ type: "notification-dispatch" });

  if (minute === 15) {
    jobs.push({
      type: "local-events",
      chunkIndex: currentLocalEventChunkIndex(scheduledAt, LOCAL_EVENT_CHUNK_COUNT),
    });
    if (hour === 6) jobs.push({ type: "prune-sync-runs" }, { type: "prune-analytics" });
  }

  // 예전에는 Promise.all로 한 invocation에서 둘을 같이 돌려 CPU를 나눠 썼다.
  if (minute === 30 && hour % 3 === 0) jobs.push({ type: "agent-head" }, { type: "agent-image" });

  if (minute === 21) {
    for (const site of sitesForHour(CITY_FESTIVAL_SITES, scheduledAt)) {
      jobs.push({ type: "city-festival-site", siteId: site.siteId });
    }
  }

  // 월별 1페이지만 넣고, 항목이 있으면 페이지 핸들러가 다음 페이지를 이어 넣는다.
  if (minute === 21 && hour === 5) {
    for (const target of akeiTargetMonths(scheduledAt)) {
      jobs.push({ type: "akei-page", year: target.year, month: target.month, page: 1 });
    }
  }

  return jobs;
}

// 실시간 주차는 Queue를 쓰지 않는다. 별도 `*/4` Cron invocation에서 한 shard씩
// 직접 처리한다. shard가 4개면 전체를 16분에 한 번 순회해 앱의 약 15분 갱신 정책과
// 맞고, 예전 분당 실행보다 invocation/D1/R2 사용량을 75% 줄인다.
export function realtimeShardIndex(scheduledAt: Date, shardCount: number): number {
  if (shardCount <= 1) return 0;
  const slot = Math.floor(scheduledAt.getTime() / (REALTIME_SYNC_CADENCE_MINUTES * 60_000));
  return ((slot % shardCount) + shardCount) % shardCount;
}

// 한 순회의 첫 shard에서만 정리한다. 4개 shard면 약 16분마다이고,
// `last_seen_at < now - 90분` 시간 기준이므로 아직 안 돈 shard를 지우지 않는다.
export function shouldPruneRealtime(scheduledAt: Date, shardCount: number): boolean {
  return realtimeShardIndex(scheduledAt, shardCount) === 0;
}
