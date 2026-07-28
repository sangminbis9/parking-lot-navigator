import * as cheerio from "cheerio";
import type { CitySiteConfig, RawCityFestivalCandidate } from "./types.js";

export function parseDeclarative(
  html: string,
  config: CitySiteConfig
): RawCityFestivalCandidate[] {
  if (!config.selectors) return [];
  const { itemSelector, titleSelector, dateSelector, linkSelector, imageSelector } =
    config.selectors;
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

    results.push({
      title,
      startDateRaw: dateText,
      endDateRaw: dateText,
      venueRaw: null,
      addressRaw: null,
      detailUrl,
      imageUrl
    });
  });

  return results;
}

function resolveUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}
