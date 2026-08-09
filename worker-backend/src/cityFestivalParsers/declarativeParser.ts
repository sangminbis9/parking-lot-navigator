import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../../../backend/src/features/discover/events/eventProviderUtils.js";
import { DetailFetchBudget, DETAIL_FETCH_CONCURRENCY, mapWithConcurrency } from "./types.js";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./types.js";

const DETAIL_FETCH_TIMEOUT_MS = 8000;

// 일부 사이트(순창군 sftf 등)는 상세 페이지에서 라벨과 값이 별도 엘리먼트로
// 분리되지 않고 <li><span>장소</span>실제값</li>처럼 한 엘리먼트에 붙어 있어,
// selector로 텍스트를 뽑으면 "장소실제값"처럼 라벨이 그대로 섞인다. 이런
// 게시판 템플릿에서 반복적으로 쓰이는 라벨 단어만 화이트리스트로 앞에서
// 제거한다(2026-08-09 순창 sftf 실측 확인).
const DETAIL_LABEL_PREFIXES = ["장소", "주소", "위치", "소재지"];

function stripDetailLabelPrefix(text: string): string {
  for (const label of DETAIL_LABEL_PREFIXES) {
    if (text.startsWith(label)) return text.slice(label.length).trim();
  }
  return text;
}

export async function parseDeclarative(
  html: string,
  config: CitySiteConfig,
  budget?: DetailFetchBudget
): Promise<RawCityFestivalCandidate[]> {
  if (!config.selectors) return [];
  const {
    itemSelector,
    titleSelector,
    dateSelector,
    linkSelector,
    imageSelector,
    venueSelector,
    addressSelector,
    detailVenueSelector,
    detailAddressSelector
  } = config.selectors;
  const $ = cheerio.load(html);
  const results: RawCityFestivalCandidate[] = [];

  $(itemSelector).each((_index, element) => {
    const item = $(element);
    const title = item.find(titleSelector).first().text().trim() || null;
    const dateText = item.find(dateSelector).first().text().trim() || null;
    const linkHref = item.find(linkSelector).first().attr("href") ?? null;
    const detailUrl = resolveUrl(linkHref, config.listUrl);
    const imageSrc = imageSelector
      ? (item.find(imageSelector).first().attr("src") ?? null)
      : null;
    const imageUrl = resolveUrl(imageSrc, config.listUrl);
    const venueRaw = venueSelector
      ? item.find(venueSelector).first().text().trim() || null
      : null;
    const addressRaw = addressSelector
      ? item.find(addressSelector).first().text().trim() || null
      : null;

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw,
      addressRaw,
      detailUrl,
      imageUrl
    });
  });

  if (detailVenueSelector || detailAddressSelector) {
    await mapWithConcurrency(results, DETAIL_FETCH_CONCURRENCY, (candidate) =>
      fillLocationFromDetail(candidate, detailVenueSelector, detailAddressSelector, budget, config.siteId)
    );
  }

  return results;
}

async function fillLocationFromDetail(
  candidate: RawCityFestivalCandidate,
  detailVenueSelector: string | undefined,
  detailAddressSelector: string | undefined,
  budget: DetailFetchBudget | undefined,
  siteId: string
): Promise<void> {
  if (!candidate.detailUrl) return;
  if (budget && !budget.tryConsume(siteId)) return;
  try {
    const response = await fetchWithTimeout(
      new URL(candidate.detailUrl),
      { headers: { "User-Agent": "Mozilla/5.0 ParkingLotNavigator/1.0" } },
      DETAIL_FETCH_TIMEOUT_MS
    );
    if (!response.ok) return;
    const $detail = cheerio.load(await response.text());
    if (detailVenueSelector) {
      const venue = stripDetailLabelPrefix(
        $detail(detailVenueSelector).first().text().replace(/\s+/g, " ").trim()
      );
      if (venue) candidate.venueRaw = venue;
    }
    if (detailAddressSelector) {
      const address = stripDetailLabelPrefix(
        $detail(detailAddressSelector).first().text().replace(/\s+/g, " ").trim()
      );
      if (address) candidate.addressRaw = address;
    }
  } catch {
    // best-effort: 상세 페이지 fetch 실패는 무시하고 fallback 좌표로 남긴다
  }
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}
