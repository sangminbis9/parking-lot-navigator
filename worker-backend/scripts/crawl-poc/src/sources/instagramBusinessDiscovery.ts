import type { CandidateEvent, SampleStore, SourceFetchResult } from "../common/types.js";

interface InstagramMedia {
  id: string;
  caption?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  media_type?: string;
}

interface InstagramResponse {
  business_discovery?: {
    username?: string;
    media?: {
      data?: InstagramMedia[];
    };
  };
  error?: {
    message?: string;
  };
}

const benefitPattern = /(\d{1,2}%\s?할인|1\+1|2\+1|증정|무료|반값|쿠폰)/;
const datePattern = /(\d{1,2}\/\d{1,2}|\d{1,2}월\s?\d{1,2}일).*?(까지|~|부터)/;
const eventPattern = /(\d{1,2}%\s?할인|1\+1|2\+1|증정|무료|반값|쿠폰|이벤트|리뷰|방문|팝업|오픈|한정)/i;

export async function crawlInstagramBusinessDiscovery(store: SampleStore): Promise<SourceFetchResult> {
  if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
    return { ok: false, source: "instagram", store, events: [], reason: "skipped: no credentials" };
  }
  if (!store.instagramHandle) {
    return { ok: false, source: "instagram", store, events: [], reason: "skipped: missing instagramHandle" };
  }

  const fields = `business_discovery.username(${store.instagramHandle}){username,media.limit(10){id,caption,media_url,permalink,timestamp,media_type}}`;
  const url = new URL(`https://graph.facebook.com/v19.0/${process.env.IG_USER_ID}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", process.env.IG_ACCESS_TOKEN);

  const response = await fetch(url.toString());
  if (!response.ok) {
    return { ok: false, source: "instagram", store, events: [], reason: `http:${response.status}` };
  }
  const body = (await response.json()) as InstagramResponse;
  if (body.error?.message) {
    return { ok: false, source: "instagram", store, events: [], reason: body.error.message };
  }

  const media = body.business_discovery?.media?.data ?? [];
  const events = media
    .filter((item) => eventPattern.test(item.caption ?? ""))
    .map((item) => mapMedia(item, store));
  return events.length > 0
    ? { ok: true, source: "instagram", store, events }
    : { ok: false, source: "instagram", store, events: [], reason: "no_event_media" };
}

function mapMedia(media: InstagramMedia, store: SampleStore): CandidateEvent {
  const caption = media.caption ?? "";
  const range = dateRange(caption);
  return {
    source: "instagram",
    placeId: store.instagramHandle ?? "",
    placeName: store.placeName,
    title: firstLine(caption),
    body: caption || null,
    imageUrls: media.media_url ? [media.media_url] : [],
    startDate: range.startDate,
    endDate: range.endDate,
    benefit: benefit(caption),
    postedAt: media.timestamp ? new Date(media.timestamp).toISOString() : null,
    permalink: media.permalink ?? null,
    rawSnippet: caption.slice(0, 500)
  };
}

function benefit(text: string): string | null {
  return text.match(benefitPattern)?.[1] ?? null;
}

function dateRange(text: string): { startDate: string | null; endDate: string | null } {
  const match = text.match(datePattern);
  if (!match) return { startDate: null, endDate: null };
  const normalized = normalizeDate(match[1]);
  return { startDate: normalized, endDate: match[2] === "부터" ? null : normalized };
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const now = new Date();
  const slash = value.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${now.getFullYear()}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  const korean = value.match(/(\d{1,2})월\s?(\d{1,2})일/);
  if (korean) return `${now.getFullYear()}-${korean[1].padStart(2, "0")}-${korean[2].padStart(2, "0")}`;
  return null;
}

function firstLine(text: string): string | null {
  const line = text.split(/\r?\n/).find((item) => item.trim());
  return line ? line.trim().slice(0, 120) : null;
}
