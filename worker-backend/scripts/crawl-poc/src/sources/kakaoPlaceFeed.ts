import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CandidateEvent, SourceFetchResult, SampleStore } from "../common/types.js";

interface CrawlOptions {
  saveFixture: boolean;
  fixtureDir: string;
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const eventPattern = /(\d{1,2}%\s?할인|1\+1|2\+1|증정|무료|반값|쿠폰|이벤트|리뷰|방문|팝업|오픈|한정)/i;
const benefitPattern = /(\d{1,2}%\s?할인|1\+1|2\+1|증정|무료|반값|쿠폰)/i;
const datePattern = /(\d{1,2}[./월]\s?\d{1,2}일?).{0,30}?((?:까지|~|부터)|(\d{1,2}[./월]\s?\d{1,2}일?))/;

export async function crawlKakaoPlaceFeed(store: SampleStore, options: CrawlOptions): Promise<SourceFetchResult> {
  if (!store.kakaoPlaceId) {
    return { ok: false, source: "kakao_place_feed", store, events: [], reason: "skipped: missing kakaoPlaceId" };
  }

  await sleep(800);
  const url = `https://place.map.kakao.com/main/v/${store.kakaoPlaceId}`;
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/json" } });
  if (response.status === 429 || response.status === 403) {
    return { ok: false, source: "kakao_place_feed", store, events: [], reason: `blocked:${response.status}` };
  }
  if (!response.ok) {
    return { ok: false, source: "kakao_place_feed", store, events: [], reason: `http:${response.status}` };
  }

  const text = await response.text();
  if (options.saveFixture) {
    await saveFixture(options.fixtureDir, `kakao-${store.kakaoPlaceId}`, text);
  }
  const payload = parseJsonOrHtmlState(text);
  if (!payload) {
    return { ok: false, source: "kakao_place_feed", store, events: [], reason: "parse_failed" };
  }

  const events = extractEvents(payload, store, url).slice(0, 10);
  return events.length > 0
    ? { ok: true, source: "kakao_place_feed", store, events }
    : { ok: false, source: "kakao_place_feed", store, events: [], reason: "no_feed_items" };
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
    const title = firstString(record, ["title", "name", "subject", "noticeTitle", "postTitle"]);
    const body = firstString(record, ["body", "content", "contents", "description", "message", "text", "noticeContent", "postContent"]);
    const combined = [title, body].filter(Boolean).join(" ");
    if (combined && eventPattern.test(combined)) {
      events.push({
        source: "kakao_place_feed",
        placeId: store.kakaoPlaceId ?? "",
        placeName: store.placeName,
        title,
        body,
        imageUrls: imageUrls(record),
        startDate: dateRange(combined).startDate,
        endDate: dateRange(combined).endDate,
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

function parseJsonOrHtmlState(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return safeJson(trimmed);

  const $ = cheerio.load(text);
  const nextData = $("#__NEXT_DATA__").text();
  if (nextData) return safeJson(nextData);

  const scripts = $("script").toArray().map((script) => $(script).html() ?? "");
  for (const script of scripts) {
    const preloaded = script.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (preloaded?.[1]) {
      const parsed = safeJson(preloaded[1]);
      if (parsed) return parsed;
    }
    if (script.includes("plusInfo") || script.includes("notice") || script.includes("feed")) {
      const objectMatch = script.match(/(\{[\s\S]*\})/);
      if (objectMatch?.[1]) {
        const parsed = safeJson(objectMatch[1]);
        if (parsed) return parsed;
      }
    }
  }
  return null;
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

async function saveFixture(fixtureDir: string, name: string, text: string): Promise<void> {
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(path.join(fixtureDir, `${sanitize(name)}.html`), text);
}

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "_");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
