import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CandidateEvent, SampleStore, SourceFetchResult } from "../common/types.js";

interface CrawlOptions {
  saveFixture: boolean;
  fixtureDir: string;
}

const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const eventPattern = /(\d{1,2}%\s?할인|1\+1|2\+1|증정|무료|반값|쿠폰|이벤트|리뷰|방문|팝업|오픈|한정)/i;
const benefitPattern = /(\d{1,2}%\s?할인|1\+1|2\+1|증정|무료|반값|쿠폰)/i;
const datePattern = /(\d{1,2}[./월]\s?\d{1,2}일?).{0,30}?((?:까지|~|부터)|(\d{1,2}[./월]\s?\d{1,2}일?))/;

export async function crawlNaverPlaceFeed(store: SampleStore, options: CrawlOptions): Promise<SourceFetchResult> {
  if (!store.naverPlaceId) {
    return { ok: false, source: "naver_place_feed", store, events: [], reason: "skipped: missing naverPlaceId" };
  }

  await sleep(800);
  const url = `https://m.place.naver.com/restaurant/${store.naverPlaceId}/feed`;
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html" } });
  if (response.status === 429 || response.status === 403) {
    return { ok: false, source: "naver_place_feed", store, events: [], reason: `blocked:${response.status}` };
  }
  if (!response.ok) {
    return { ok: false, source: "naver_place_feed", store, events: [], reason: `http:${response.status}` };
  }

  const html = await response.text();
  if (options.saveFixture) {
    await saveFixture(options.fixtureDir, `naver-${store.naverPlaceId}`, html);
  }
  const payload = parseHtmlState(html);
  if (!payload) {
    return { ok: false, source: "naver_place_feed", store, events: [], reason: "parse_failed" };
  }

  const events = extractEvents(payload, store, url).slice(0, 10);
  return events.length > 0
    ? { ok: true, source: "naver_place_feed", store, events }
    : { ok: false, source: "naver_place_feed", store, events: [], reason: "no_feed_items" };
}

function parseHtmlState(html: string): unknown | null {
  const $ = cheerio.load(html);
  const apollo = $("#__APOLLO_STATE__").text();
  if (apollo) return safeJson(apollo);
  const nextData = $("#__NEXT_DATA__").text();
  if (nextData) return safeJson(nextData);

  for (const script of $("script").toArray().map((item) => $(item).html() ?? "")) {
    if (!script.includes("feed") && !script.includes("notice") && !script.includes("Apollo")) continue;
    const assignment = script.match(/(?:window\.)?(?:__APOLLO_STATE__|__PRELOADED_STATE__)\s*=\s*(\{[\s\S]*?\});/);
    if (assignment?.[1]) {
      const parsed = safeJson(assignment[1]);
      if (parsed) return parsed;
    }
    const objectMatch = script.match(/(\{[\s\S]*\})/);
    if (objectMatch?.[1]) {
      const parsed = safeJson(objectMatch[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractEvents(payload: unknown, store: SampleStore, fallbackUrl: string): CandidateEvent[] {
  const events: CandidateEvent[] = [];
  const visited = new Set<unknown>();

  function visit(value: unknown): void {
    if (!value || typeof value !== "object" || visited.has(value) || events.length >= 20) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    const title = firstString(record, ["title", "name", "subject", "feedTitle", "noticeTitle"]);
    const body = firstString(record, ["body", "content", "contents", "description", "message", "text", "feedContent", "noticeContent"]);
    const combined = [title, body].filter(Boolean).join(" ");
    if (combined && eventPattern.test(combined)) {
      const range = dateRange(combined);
      events.push({
        source: "naver_place_feed",
        placeId: store.naverPlaceId ?? "",
        placeName: store.placeName,
        title,
        body,
        imageUrls: imageUrls(record),
        startDate: range.startDate,
        endDate: range.endDate,
        benefit: benefit(combined),
        postedAt: postedAt(record),
        permalink: firstString(record, ["permalink", "link", "url", "shareUrl"]) ?? fallbackUrl,
        rawSnippet: combined.slice(0, 500)
      });
    }

    for (const child of Object.values(record)) visit(child);
  }

  visit(payload);
  return dedupe(events);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return clean(value);
  }
  return null;
}

function imageUrls(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  collectStrings(record, values);
  return [...new Set(values.filter((value) => /^https?:\/\/.+\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(value)))].slice(0, 5);
}

function collectStrings(value: unknown, output: string[]): void {
  if (!value || output.length > 100) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, output);
  }
}

function benefit(text: string): string | null {
  return clean(text.match(benefitPattern)?.[1]);
}

function dateRange(text: string): { startDate: string | null; endDate: string | null } {
  const match = text.match(datePattern);
  if (!match) return { startDate: null, endDate: null };
  return { startDate: normalizeDate(match[1]), endDate: normalizeDate(match[3] ?? match[1]) };
}

function postedAt(record: Record<string, unknown>): string | null {
  const value = firstString(record, ["createdAt", "createdDate", "publishedAt", "regDate", "date", "created"]);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const now = new Date();
  const match = value.match(/(\d{1,2})[./월]\s?(\d{1,2})/);
  if (!match) return null;
  return `${now.getFullYear()}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function dedupe(events: CandidateEvent[]): CandidateEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.title, event.body, event.permalink].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function saveFixture(fixtureDir: string, name: string, html: string): Promise<void> {
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(path.join(fixtureDir, `${sanitize(name)}.html`), html);
}

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "_");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
