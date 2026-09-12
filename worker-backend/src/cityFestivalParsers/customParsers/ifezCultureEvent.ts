import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "../types.js";

// 인천경제자유구역청(IFEZ) "축제/행사" 게시판
// (www.ifez.go.kr/main/culture/event/list.do). 송도·영종·청라는 인천시
// 기초자치단체 경계와 따로 노는 IFEZ 관할이라 itour.incheon.go.kr의
// 구·군별 축제 목록에 올라오지 않는 행사가 있다(2026 IFEZ 글로벌 페스티벌
// I♥FEsta가 그 사례) — 기존 인천투어 소스를 유지한 채 보완 소스로 붙인다.
//
// IFEZ 보도자료 게시판(main/pst/list.do?pst_id=noti03)이 아니라 이 게시판을
// 쓰는 이유: 보도자료 목록에는 작성일만 있고 행사 날짜·장소가 없다. 상세
// 본문은 HWP에서 내보낸 HTML이라 "오는 9 월 12 일 송도"처럼 숫자가 태그
// 사이에서 쪼개지고 연도도 없으며, 보도자료 하나가 행사 셋을 함께 다루는
// 경우가 있어 날짜·장소를 안전하게 뽑을 수 없다(2026-09-12 실측). 반면 이
// 게시판은 구조적으로 행사만 올라오고 목록 자체가 "기간"(YYYY.MM.DD ~
// YYYY.MM.DD)과 "장소"를 dl/dt/dd로 제공해, 일반 행정 보도자료가 섞일
// 여지도 없고 상세 페이지를 추가로 열 필요도 없다.
//
// 라벨(기간/장소)이 dt에 들어 있고 dd 순서가 항목마다 다를 수 있어
// (비용 dl이 빠지는 항목이 있다) declarative parser의 selector 위치 지정으로는
// 안전하지 않다. dt 텍스트로 찾는다.
//
// 날짜와 장소를 둘 다 확인하지 못한 항목은 후보에서 제외한다. 좌표를
// 지오코딩할 근거가 없는 항목이 IFEZ 대표 좌표로 게시되는 것을 막는다.
export function parseIfezCultureEvent(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(".cm_board_list5 ul.board_list > li").each((_index, element) => {
    const item = $(element);
    const title = item.find(".board_title").first().text().replace(/\s+/g, " ").trim();
    if (!title) return;

    const info = new Map<string, string>();
    item.find(".board_info dl").each((_i, dl) => {
      const label = $(dl).find("dt").first().text().trim();
      const value = $(dl).find("dd").first().text().replace(/\s+/g, " ").trim();
      if (label && value) info.set(label, value);
    });

    const period = info.get("기간");
    const venue = info.get("장소");
    if (!period || !venue) return;

    // 목록 링크는 세션마다 바뀌는 search 토큰을 달고 있어 그대로 쓰면
    // source_url이 매 수집마다 달라진다. 상세 페이지는 schdl_mng_sn만으로
    // 열리므로(2026-09-12 실측) 안정적인 형태로 다시 만든다.
    const href = item.find("a.board_item").first().attr("href") ?? "";
    const serial = /schdl_mng_sn=(\d+)/.exec(href)?.[1] ?? null;
    const detailUrl = serial
      ? new URL(`view.do?schdl_mng_sn=${serial}`, config.listUrl).toString()
      : null;
    const imageUrl = serial
      ? new URL(`process.file.do?TP=img&schdl_mng_sn=${serial}&width=238`, config.listUrl).toString()
      : null;

    results.push({
      title,
      startDateRaw: period,
      endDateRaw: period,
      venueRaw: venue,
      addressRaw: null,
      detailUrl,
      imageUrl
    });
  });

  return results;
}
