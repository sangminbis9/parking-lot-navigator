import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 순천시(suncheon.go.kr) 축제 페이지는 화면에 JS로 렌더링되고 실제 데이터는
// eventV3/list.do가 반환하는 JSON(dataList)이다. staticVO.pageSize는 10으로
// 선언돼 있지만 실측 결과 dataList는 totalCount 전량을 그대로 반환해
// 페이지네이션이 필요 없다(2026-07-30 확인). EXT01 필드가 행사/축제/기타/
// 전시/공연 카테고리를 나누므로 "축제"만 걸러낸다 — 제목에 "축제"가 들어가도
// EXT01이 "행사"인 경우가 있어(예: 동천야광축제) 이름이 아니라 이 필드로
// 판별해야 한다.
const DETAIL_BASE = "https://www.suncheon.go.kr/tour/festival/0001/?boardId=bbs_0000000000011687&mode=view&cntId=";

interface SuncheonEventItem {
  ID: string | number | null;
  TITLE: string | null;
  DATE01: string | null;
  DATE02: string | null;
  EXT01: string | null;
  EXT07: string | null;
}

interface SuncheonEventResponse {
  dataList: SuncheonEventItem[];
}

export function parseSuncheonTour(
  json: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  let parsed: SuncheonEventResponse;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.dataList)) return [];

  const results: RawCityFestivalCandidate[] = [];
  for (const item of parsed.dataList) {
    if (item.EXT01 !== "축제") continue;

    results.push({
      title: item.TITLE || null,
      startDateRaw: item.DATE01 || null,
      endDateRaw: item.DATE02 || null,
      venueRaw: item.EXT07 || null,
      addressRaw: null,
      detailUrl: item.ID ? `${DETAIL_BASE}${item.ID}` : null,
      imageUrl: null
    });
  }

  return results;
}
