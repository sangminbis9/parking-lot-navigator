import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enrichTourApiItems,
  type TourApiDetailClient,
} from "../src/features/discover/festivals/tourApiDetailClient.js";

// programTargets 상한과 같은 값. 이 창이 회차마다 앞으로 밀려야 한다.
const PROGRAM_ENRICH_MAX_ITEMS = 8;

describe("TourAPI program enrich rotation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves the program window forward each hour so every item eventually gets opened", async () => {
    const first = await openedIdsAtHour(0);
    const second = await openedIdsAtHour(1);

    expect(first).toEqual(ids(0, PROGRAM_ENRICH_MAX_ITEMS));
    expect(second).toEqual(
      ids(PROGRAM_ENRICH_MAX_ITEMS, PROGRAM_ENRICH_MAX_ITEMS),
    );
  });

  it("wraps around the end of the candidate list", async () => {
    // 후보 32건, 창 8건 -> slot 4에서 시작점이 32 % 32 === 0으로 되돌아온다.
    expect(await openedIdsAtHour(3)).toEqual(ids(24, PROGRAM_ENRICH_MAX_ITEMS));
    expect(await openedIdsAtHour(4)).toEqual(ids(0, PROGRAM_ENRICH_MAX_ITEMS));
  });
});

async function openedIdsAtHour(hour: number): Promise<string[]> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hour * 3_600_000));
  const opened: string[] = [];
  const client = {
    // intro에 프로그램 정보가 없는 소스를 흉내낸다. 늘 null이라 후보에서
    // 빠지지 않으므로, 회전이 없으면 같은 8건만 영원히 다시 열린다.
    programInfo: async (contentId: string) => {
      opened.push(contentId);
      return null;
    },
    detail: async () => {
      throw new Error("detail should not be called for complete items");
    },
  } as unknown as TourApiDetailClient;

  await enrichTourApiItems(completeItems(), client);
  vi.useRealTimers();
  return [...opened].sort(byIndex);
}

function byIndex(a: string, b: string): number {
  return Number(a) - Number(b);
}

function ids(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i));
}

/// 핵심 4필드가 모두 찬 32건. programInfo만 비어 있어 program 창의 후보가 된다.
/// startDate는 인덱스 순으로 늘어나므로 정렬 후 순서가 인덱스와 같다.
function completeItems() {
  return Array.from({ length: 32 }, (_, index) => ({
    contentId: String(index),
    startDate: `2026-09-${String(index + 1).padStart(2, "0")}`,
    description: "설명",
    sourceUrl: "https://example.com",
    imageUrl: "https://example.com/a.jpg",
    venueName: "장소",
    programInfo: null,
  }));
}
