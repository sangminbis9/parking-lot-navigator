import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAkeiListPage, runAkeiTradeExpoDiscovery } from "../src/akeiTradeExpoDiscovery.js";

// AKEI 목록 페이지에서 2026-08-08에 직접 fetch로 확인한 실제 응답을 축약한 픽스처.
// 상세 <table> 블록은 파서가 쓰지 않으므로 생략했다.
const AKEI_LIST_FIXTURE_TWO_ITEMS = `
<div class="exhibit_list">
    <ul>
        <li class="content_sc_li" id="content_sc_104847">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104847" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;키워 특수동물 EXPO with 크리에이터 기획전 정브르 x 헌터퐝                </p></strong>
                    <ul>
                        <li>주 최 : 주식회사 키워, 주식회사 헌터퐝</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 송도컨벤시아(Songdo ConvensiA)</li>
                    </ul>
                </a>
            </div>
        </li>
        <li class="content_sc_li" id="content_sc_104910">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104910" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;제424회 웨덱스 웨딩박람회                </p></strong>
                    <ul>
                        <li>주 최 : ㈜웨덱스웨딩</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 코엑스(COEX)</li>
                    </ul>
                </a>
            </div>
        </li>
    </ul>
</div>
`;

const AKEI_LIST_FIXTURE_EMPTY = `<div class="exhibit_list"><ul></ul></div>`;

// 2026-08-08에 확인한 실제 응답 중 일부 행은 제목 <p> 안에 인증 배지 <span>이
// 붙어 있고, 그 사이에 줄바꿈/탭이 섞여 있다. 파서가 span 텍스트와 내부 공백
// 뭉치를 그대로 남기지 않는지 검증하기 위한 픽스처.
const AKEI_LIST_FIXTURE_WITH_BADGE = `
<div class="exhibit_list">
    <ul>
        <li class="content_sc_li" id="content_sc_104847">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104847" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;키워 특수동물 EXPO with 크리에이터 기획전 정브르 x 헌터퐝                </p></strong>
                    <ul>
                        <li>주 최 : 주식회사 키워, 주식회사 헌터퐝</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 송도컨벤시아(Songdo ConvensiA)</li>
                    </ul>
                </a>
            </div>
        </li>
        <li class="content_sc_li" id="content_sc_104910">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=104910" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;제424회 웨덱스 웨딩박람회                </p></strong>
                    <ul>
                        <li>주 최 : ㈜웨덱스웨딩</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 코엑스(COEX)</li>
                    </ul>
                </a>
            </div>
        </li>
        <li class="content_sc_li" id="content_sc_105002">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=105002" class="btn_toggle_sc_li">
                    <strong><p>
    <span>국제인증전시회+</span>
    &nbsp;2026 코리아빌드                </p></strong>
                    <ul>
                        <li>주 최 : 코리아빌드 조직위원회</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 킨텍스(KINTEX)</li>
                    </ul>
                </a>
            </div>
        </li>
    </ul>
</div>
`;

describe("parseAkeiListPage", () => {
  it("extracts wrId, title, organizer, dates, and venue from real list markup", () => {
    const candidates = parseAkeiListPage(AKEI_LIST_FIXTURE_TWO_ITEMS);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      wrId: "104847",
      title: "키워 특수동물 EXPO with 크리에이터 기획전 정브르 x 헌터퐝",
      organizer: "주식회사 키워, 주식회사 헌터퐝",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      venueText: "송도컨벤시아(Songdo ConvensiA)",
      sourceUrl: "https://www.akei.or.kr/bbs/board.php?bo_table=schedule&wr_id=104847",
    });
    expect(candidates[1].wrId).toBe("104910");
    expect(candidates[1].venueText).toBe("코엑스(COEX)");
  });

  it("returns an empty array when the page has no rows", () => {
    expect(parseAkeiListPage(AKEI_LIST_FIXTURE_EMPTY)).toEqual([]);
  });

  it("strips a certification badge <span> from the title and collapses internal whitespace", () => {
    const candidates = parseAkeiListPage(AKEI_LIST_FIXTURE_WITH_BADGE);

    expect(candidates).toHaveLength(3);
    expect(candidates[2].wrId).toBe("105002");
    expect(candidates[2].title).toBe("2026 코리아빌드");
  });
});

// 코엑스로 매핑되는 유효한 후보 row를 count개 생성한다 (단일 페이지 응답용).
function buildAkeiListFixture(count: number): string {
  const items = Array.from({ length: count }, (_, i) => {
    const id = 200000 + i;
    return `
        <li class="content_sc_li" id="content_sc_${id}">
            <div class="txt">
                <a href="#https://www.akei.or.kr/bbs/board.php?bo_table=schedule&amp;wr_id=${id}" class="btn_toggle_sc_li">
                    <strong><p>
                        &nbsp;테스트 박람회 ${id}                </p></strong>
                    <ul>
                        <li>주 최 : 테스트 주최사</li>
                        <li>기 간 : 2026-08-01~2026-08-02</li>
                        <li>장 소 : 코엑스(COEX)</li>
                    </ul>
                </a>
            </div>
        </li>`;
  }).join("\n");
  return `<div class="exhibit_list"><ul>${items}</ul></div>`;
}

function fakeDb(): { db: D1Database; batch: ReturnType<typeof vi.fn> } {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: () => ({ bind: () => ({}) }),
    batch,
  } as unknown as D1Database;
  return { db, batch };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAkeiTradeExpoDiscovery", () => {
  it("processes the first page's candidate, resolves its venue, and upserts it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(AKEI_LIST_FIXTURE_TWO_ITEMS, { status: 200 }))
      .mockImplementation(async () => new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, batch } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.processed).toBe(2);
    expect(result.published).toBe(2);
    expect(result.unmappedVenues).toBe(0);
    expect(result.failedMonths).toEqual([]);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
  });

  it("skips a candidate whose venue text has no coordinate mapping", async () => {
    const unmappedFixture = AKEI_LIST_FIXTURE_TWO_ITEMS.replace(
      "코엑스(COEX)",
      "듣도보도못한전시장",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(unmappedFixture, { status: 200 }))
      .mockImplementation(async () => new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, batch } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.processed).toBe(2);
    expect(result.published).toBe(1);
    expect(result.unmappedVenues).toBe(1);
    expect(batch.mock.calls[0][0]).toHaveLength(1);
  });

  it("records a failing month in failedMonths and still processes later months", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockImplementation(async () => new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.failedMonths).toEqual(["2026-08"]);
    expect(result.processed).toBe(0);
  });

  it("treats a non-ok HTTP response as a page fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { db } = fakeDb();

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.failedMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("stops paginating a month once a page returns zero rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(AKEI_LIST_FIXTURE_TWO_ITEMS, { status: 200 }))
      .mockImplementation(async () => new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb();

    await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    // month0: page1(2 items) + page2(empty, stop) = 2 calls; month1: page1(empty) = 1 call; month2: page1(empty) = 1 call
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("chunks upserts into batches of 50 and keeps other chunks' rows when one chunk's batch fails", async () => {
    const rowCount = 60;
    const fixture = buildAkeiListFixture(rowCount);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
      .mockImplementation(async () => new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const batch = vi
      .fn()
      .mockResolvedValueOnce([]) // first 50-row chunk succeeds
      .mockRejectedValueOnce(new Error("D1_ERROR: too many statements in batch")) // second (10-row) chunk fails
      .mockResolvedValue([]);
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch,
    } as unknown as D1Database;

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.processed).toBe(rowCount);
    expect(result.published).toBe(rowCount);
    expect(result.failedBatches).toBe(1);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[0][0]).toHaveLength(50);
    expect(batch.mock.calls[1][0]).toHaveLength(10);
  });

  it("still attempts later chunks after a mid-run batch failure (not just a trailing one)", async () => {
    const rowCount = 110; // 3 chunks: 50, 50, 10
    const fixture = buildAkeiListFixture(rowCount);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
      .mockImplementation(async () => new Response(AKEI_LIST_FIXTURE_EMPTY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const batch = vi
      .fn()
      .mockResolvedValueOnce([]) // 1st chunk (50 rows) succeeds
      .mockRejectedValueOnce(new Error("D1_ERROR: too many statements in batch")) // 2nd chunk (50 rows) fails
      .mockResolvedValueOnce([]); // 3rd chunk (10 rows) — must still be attempted despite the 2nd chunk's failure
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch,
    } as unknown as D1Database;

    const result = await runAkeiTradeExpoDiscovery(db, new Date(Date.UTC(2026, 7, 1)));

    expect(result.failedBatches).toBe(1);
    expect(batch).toHaveBeenCalledTimes(3);
    expect(batch.mock.calls[0][0]).toHaveLength(50);
    expect(batch.mock.calls[1][0]).toHaveLength(50);
    expect(batch.mock.calls[2][0]).toHaveLength(10); // proves the 3rd (post-failure) chunk was still attempted
  });
});
