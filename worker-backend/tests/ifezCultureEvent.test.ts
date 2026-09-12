import { describe, expect, it } from "vitest";
import { parseIfezCultureEvent } from "../src/cityFestivalParsers/customParsers/ifezCultureEvent.js";
import { CITY_FESTIVAL_SITES } from "../src/cityFestivalSites.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";

const config = CITY_FESTIVAL_SITES.find((site) => site.siteId === "ifez-culture-event") as CitySiteConfig;

function listItem(options: {
  serial: string;
  title: string;
  period?: string;
  venue?: string;
  cost?: string;
}): string {
  const rows = [
    options.period ? `<dl><dt>기간</dt><dd>${options.period}</dd></dl>` : "",
    options.venue ? `<dl><dt>장소</dt><dd>${options.venue}</dd></dl>` : "",
    options.cost ? `<dl><dt>비용</dt><dd>${options.cost}</dd></dl>` : ""
  ].join("\n");
  return `
    <li>
      <a class="board_item" href="view.do?schdl_mng_sn=${options.serial}&amp;state=&amp;search=VVppMi8vck9NWndkRnhPSGUySXZBZz09&amp;menu_se=list">
        <div class="board_thumb"><img src="process.file.do?TP=img&amp;schdl_mng_sn=${options.serial}&amp;width=238" /></div>
        <div class="board_content">
          <div class="board_cate cm_state2 state1">진행중</div>
          <div class="board_title">${options.title}</div>
          <div class="board_info">${rows}</div>
        </div>
      </a>
    </li>`;
}

function board(items: string[]): string {
  return `<div class="cm_board_list5"><ul class="board_list">${items.join("\n")}</ul></div>`;
}

describe("parseIfezCultureEvent", () => {
  it("registers the site with the ifez custom parser", () => {
    expect(config).toBeDefined();
    expect(config.customParser).toBe("ifez-culture-event");
  });

  it("extracts title, period and venue from the board list", () => {
    const html = board([
      listItem({
        serial: "18354",
        title: "I♥FEsta 송도",
        period: "2026.09.12 ~ 2026.09.12",
        venue: "센트럴파크 잔디광장",
        cost: "무료"
      })
    ]);

    const result = parseIfezCultureEvent(html, config);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "I♥FEsta 송도",
      startDateRaw: "2026.09.12 ~ 2026.09.12",
      endDateRaw: "2026.09.12 ~ 2026.09.12",
      venueRaw: "센트럴파크 잔디광장",
      addressRaw: null
    });
  });

  it("builds a stable detail url without the per-session search token", () => {
    const html = board([
      listItem({ serial: "18353", title: "청라 페스티벌", period: "2025.09.09 ~ 2025.09.28", venue: "청라 호수공원" })
    ]);

    const [candidate] = parseIfezCultureEvent(html, config);

    expect(candidate.detailUrl).toBe("https://www.ifez.go.kr/main/culture/event/view.do?schdl_mng_sn=18353");
    expect(candidate.imageUrl).toBe(
      "https://www.ifez.go.kr/main/culture/event/process.file.do?TP=img&schdl_mng_sn=18353&width=238"
    );
  });

  it("drops items whose period or venue is missing", () => {
    const html = board([
      listItem({ serial: "1", title: "장소 없는 행사", period: "2026.10.10 ~ 2026.10.10" }),
      listItem({ serial: "2", title: "기간 없는 행사", venue: "영종 씨사이드파크" }),
      listItem({ serial: "3", title: "제목만 있는 행사" }),
      listItem({ serial: "4", title: "정상 행사", period: "2026.10.24 ~ 2026.10.24", venue: "청라 호수공원" })
    ]);

    const result = parseIfezCultureEvent(html, config);

    expect(result.map((candidate) => candidate.title)).toEqual(["정상 행사"]);
  });

  it("reads labels by dt text rather than dl position", () => {
    const html = board([
      listItem({ serial: "5", title: "비용 먼저 오는 행사", venue: "송도 트라이보울", period: "2026.11.01 ~ 2026.11.02" })
        .replace(
          '<div class="board_info">',
          '<div class="board_info"><dl><dt>비용</dt><dd>20,000</dd></dl>'
        )
    ]);

    const [candidate] = parseIfezCultureEvent(html, config);

    expect(candidate.venueRaw).toBe("송도 트라이보울");
    expect(candidate.startDateRaw).toBe("2026.11.01 ~ 2026.11.02");
  });
});
