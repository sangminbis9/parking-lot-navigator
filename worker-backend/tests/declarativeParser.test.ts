import { describe, expect, it } from "vitest";
import { parseDeclarative } from "../src/cityFestivalParsers/declarativeParser.js";
import type { CitySiteConfig } from "../src/cityFestivalParsers/types.js";

const tableConfig: CitySiteConfig = {
  siteId: "test-table",
  cityName: "테스트시",
  listUrl: "https://example.com/festivals",
  fallbackLat: 37.5,
  fallbackLng: 127.0,
  robotsCheckedAt: "2026-07-28",
  selectors: {
    itemSelector: "tr.row",
    titleSelector: "td.title a",
    dateSelector: "td.date",
    linkSelector: "td.title a",
    imageSelector: "td.thumb img"
  }
};

describe("parseDeclarative", () => {
  it("extracts candidates from a table-based board using configured selectors", async () => {
    const html = `
      <table><tbody>
        <tr class="row">
          <td class="thumb"><img src="/img/1.jpg" /></td>
          <td class="title"><a href="/detail/1">가을 단풍 축제</a></td>
          <td class="date">2026.10.01 ~ 2026.10.03</td>
        </tr>
        <tr class="row">
          <td class="thumb"><img src="/img/2.jpg" /></td>
          <td class="title"><a href="/detail/2">겨울 빛 축제</a></td>
          <td class="date">2026.12.20 ~ 2026.12.25</td>
        </tr>
      </tbody></table>
    `;

    const result = await parseDeclarative(html, tableConfig);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: "가을 단풍 축제",
      startDateRaw: "2026.10.01 ~ 2026.10.03",
      endDateRaw: "2026.10.01 ~ 2026.10.03",
      venueRaw: null,
      addressRaw: null,
      detailUrl: "https://example.com/detail/1",
      imageUrl: "https://example.com/img/1.jpg"
    });
  });

  it("returns an empty array when the site config has no selectors (custom-parser sites)", async () => {
    const noSelectorConfig: CitySiteConfig = { ...tableConfig, selectors: undefined };
    expect(await parseDeclarative("<html></html>", noSelectorConfig)).toEqual([]);
  });

  it("skips items with no matching link and returns null detailUrl/imageUrl instead of throwing", async () => {
    const html = `<table><tbody><tr class="row"><td class="title">링크 없는 항목</td><td class="date">2026.11.01</td></tr></tbody></table>`;
    const result = await parseDeclarative(html, tableConfig);
    expect(result).toHaveLength(1);
    expect(result[0].detailUrl).toBeNull();
    expect(result[0].imageUrl).toBeNull();
  });

  it("extracts venueRaw and addressRaw when venueSelector/addressSelector are configured", async () => {
    const configWithAddress: CitySiteConfig = {
      ...tableConfig,
      selectors: {
        ...tableConfig.selectors!,
        venueSelector: "td.venue",
        addressSelector: "td.address"
      }
    };
    const html = `
      <table><tbody>
        <tr class="row">
          <td class="title"><a href="/detail/1">가을 단풍 축제</a></td>
          <td class="date">2026.10.01 ~ 2026.10.03</td>
          <td class="venue">시민공원</td>
          <td class="address">테스트시 테스트로 1</td>
        </tr>
      </tbody></table>
    `;

    const result = await parseDeclarative(html, configWithAddress);

    expect(result[0].venueRaw).toBe("시민공원");
    expect(result[0].addressRaw).toBe("테스트시 테스트로 1");
  });

  it("leaves venueRaw/addressRaw null when venueSelector/addressSelector are not configured", async () => {
    const html = `
      <table><tbody>
        <tr class="row">
          <td class="title"><a href="/detail/1">가을 단풍 축제</a></td>
          <td class="date">2026.10.01 ~ 2026.10.03</td>
        </tr>
      </tbody></table>
    `;
    const result = await parseDeclarative(html, tableConfig);
    expect(result[0].venueRaw).toBeNull();
    expect(result[0].addressRaw).toBeNull();
  });
});
