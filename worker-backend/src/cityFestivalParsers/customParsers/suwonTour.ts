import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 수원시 문화행사 목록은 정적 HTML이 아니라 smartSearchListJson.do가 반환하는
// JSON을 클라이언트에서 렌더링한다(2026-07-31 curl 확인). q_groupCd=19는
// 수원시 사이트의 "행사/축제" 카테고리 코드다(공연=23, 전시=21, 강연=25,
// 스포츠=1390과 구분됨). startDt/endDt는 "2026-07-01(수)"처럼 요일이 붙어
// 있어 cityFestivalNormalize.ts의 날짜 정규식이 그대로 매칭하지 못하므로
// 괄호 부분을 제거한다. 상세 페이지 링크는 목록 JSON에 없어, 목록 페이지의
// goView() 스크립트에서 확인한 "ingCultureView.do?ctrSeqNo=<N>&listType=sch&
// q_groupCd=19" 패턴으로 직접 구성한다.
// q_ingYn 파라미터는 필수다: 0(등록된 listUrl)은 진행중+예정(종료 안 된
// 11건)만 반환하지만, 파라미터를 빼면 종료된 과거 이벤트까지 포함해
// 848건이 돌아온다(2026-07-31 curl로 재검증).
const BASE_URL = "https://www.suwon.go.kr/culture/";

interface SuwonCultureItem {
  ctrSeqNo: number | null;
  cultureNm: string | null;
  startDt: string | null;
  endDt: string | null;
  ctrLocation: string | null;
  baseAddr: string | null;
  detailAddr: string | null;
  jibunAddr: string | null;
  thumbImage: string | null;
}

interface SuwonCultureResponse {
  dataList?: SuwonCultureItem[];
}

export function parseSuwonTour(
  json: string,
  _config: CitySiteConfig
): RawCityFestivalCandidate[] {
  let parsed: SuwonCultureResponse;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.dataList)) return [];

  const results: RawCityFestivalCandidate[] = [];
  for (const item of parsed.dataList) {
    const title = item.cultureNm?.trim() || null;
    if (!title || item.ctrSeqNo == null) continue;

    const address = item.baseAddr || item.detailAddr || item.jibunAddr || null;

    results.push({
      title,
      startDateRaw: stripWeekday(item.startDt),
      endDateRaw: stripWeekday(item.endDt),
      venueRaw: item.ctrLocation || null,
      addressRaw: address,
      detailUrl: `${BASE_URL}ingCultureView.do?ctrSeqNo=${item.ctrSeqNo}&listType=sch&q_groupCd=19`,
      imageUrl: resolveUrl(item.thumbImage)
    });
  }

  return results;
}

function stripWeekday(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\([^)]*\)/g, "").trim();
}

function resolveUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}
