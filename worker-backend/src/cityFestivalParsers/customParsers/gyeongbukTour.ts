import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 경북관광(tour.gb.go.kr)의 축제 목록은 HTML이 아니라 JSON을 반환하는 AJAX
// POST endpoint(/travel/selectListAdd.do)로 제공된다. cd_area 파라미터에
// 콤마로 여러 시/군 코드를 넘기면 한 번의 요청으로 시/군 전체 결과가
// 함께 오므로, 21개 시/군이 동일한 listUrl+body(config.fetchBody에 모든
// 코드가 포함됨)를 공유하고, 파서 안에서 item.cd_area와
// config.customParserArea(해당 사이트가 맡은 코드)를 비교해 나눈다.
// 응답에 latitude/longtitude가 이미 있어 Kakao geocoding이 필요 없다.
const DETAIL_BASE = "https://tour.gb.go.kr/travel/festivalView.do?idx=";
const THUMB_BASE = "https://tour.gb.go.kr/file/thumbnail2.do?file_physical=";

interface GyeongbukFestivalItem {
  idx: number;
  title: string | null;
  dt_start: string | null;
  dt_end: string | null;
  addr_inf: string | null;
  latitude: string | null;
  longtitude: string | null;
  cd_area: string | null;
  file_physical: string | null;
}

interface GyeongbukFestivalResponse {
  rcode: string;
  dataCount: number;
  data: GyeongbukFestivalItem[];
}

export function parseGyeongbukTour(
  json: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  let parsed: GyeongbukFestivalResponse;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (parsed.rcode !== "1" || !Array.isArray(parsed.data)) return [];

  const results: RawCityFestivalCandidate[] = [];
  for (const item of parsed.data) {
    if (item.cd_area !== config.customParserArea) continue;

    const lat = item.latitude ? Number(item.latitude) : NaN;
    const lng = item.longtitude ? Number(item.longtitude) : NaN;

    results.push({
      title: item.title || null,
      startDateRaw: item.dt_start || null,
      endDateRaw: item.dt_end || null,
      venueRaw: null,
      addressRaw: item.addr_inf || null,
      detailUrl: item.idx ? `${DETAIL_BASE}${item.idx}` : null,
      imageUrl: item.file_physical ? `${THUMB_BASE}${item.file_physical}` : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null
    });
  }

  return results;
}
