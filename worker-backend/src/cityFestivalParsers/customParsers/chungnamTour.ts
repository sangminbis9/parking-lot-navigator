import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 충남관광(tour.chungnam.go.kr) 축제/행사 목록. 충남 15개 시/군이 같은 목록을
// 공유하고 listUrl의 searchRgn 파라미터로 시/군을 가른다.
// 카드 마크업에는 날짜 텍스트가 없고 썸네일 img의 alt에만
// "<제목> YYYY-MM-DD ~ YYYY-MM-DD 장소 : <장소>" 형태로 들어있어
// selectors(텍스트 기반)로는 표현할 수 없다.
// 상세 링크도 href가 javascript:void(0)이고 data-key-no만 있어 여기서 조립한다.
const DETAIL_BASE = "https://tour.chungnam.go.kr/prog/fstvl/kor/sub02_02_02/view.do?fstvlNo=";
const ALT_DATE_PATTERN = /(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/;
const ALT_VENUE_PATTERN = /장소\s*:\s*(.+)$/;

export function parseChungnamTour(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".board--card--list .item").each((_index, element) => {
    const item = $(element);
    const title = item.find(".card--info .cb-title").first().text().trim() || null;
    const addressRaw = item.find(".card--info .cb-tit span").first().text().trim() || null;

    const alt = item.find(".thm--inner img").first().attr("alt") ?? "";
    const dateMatch = ALT_DATE_PATTERN.exec(alt);
    const venueMatch = ALT_VENUE_PATTERN.exec(alt);
    const venueRaw = venueMatch ? venueMatch[1].trim() || null : null;

    const keyNo = item.find("a.button_view").first().attr("data-key-no")?.trim() || null;
    const detailUrl = keyNo ? `${DETAIL_BASE}${encodeURIComponent(keyNo)}` : null;

    const imageSrc = item.find(".thm--inner img").first().attr("src") ?? null;
    const imageUrl = resolveUrl(stripJsessionId(imageSrc), config.listUrl);

    results.push({
      title,
      startDateRaw: dateMatch ? dateMatch[1] : null,
      endDateRaw: dateMatch ? dateMatch[2] : null,
      venueRaw,
      addressRaw,
      detailUrl,
      imageUrl
    });
  });

  return results;
}

// 이미지 경로에 세션 고정용 ;jsessionid=... 가 붙어 나오므로 떼어낸다.
function stripJsessionId(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/;jsessionid=[^?]*/i, "");
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}
