export const FESTIVAL_PRIMARY_CATEGORIES = [
  "music_performance",
  "food_drink",
  "nature_flower",
  "light_night",
  "tradition_culture",
  "family_kids",
  "market_flea",
  "sports_outdoor",
  "film_media",
  "art_exhibition",
  "etc",
] as const;

export type FestivalPrimaryCategory =
  (typeof FESTIVAL_PRIMARY_CATEGORIES)[number];

export const LOCAL_EVENT_PRIMARY_CATEGORIES = [
  "discount",
  "freebie",
  "new_limited",
  "popup",
  "opening",
  "review_event",
  "seasonal",
  "etc",
] as const;

export type LocalEventPrimaryCategory =
  (typeof LOCAL_EVENT_PRIMARY_CATEGORIES)[number];

export const TAGGING_VERSION = 1;

export interface TaggingInput {
  domain: "festival" | "local_event";
  id: string;
  title: string;
  subtitle?: string | null;
  categoryText?: string | null;
  benefit?: string | null;
  description?: string | null;
  tagsHint?: string | null;
  source?: string | null;
}

export interface TaggingResult {
  id: string;
  primaryCategory: string;
  categoryTags: string[];
}

const FESTIVAL_GUIDE = `축제(festival) 분류 기준:
- music_performance: 음악 콘서트, 페스티벌, EDM, 재즈, 클래식, K-POP 공연.
- food_drink: 음식, 와인, 맥주, 커피, 막걸리 등 먹거리 중심.
- nature_flower: 벚꽃, 장미, 단풍, 튤립, 유채, 억새 등 꽃·자연.
- light_night: 불꽃축제, 야경, 빛축제, 조명 페스티벌, 미디어파사드.
- tradition_culture: 전통 제례, 향토, 민속, 사찰, 역사 재현.
- family_kids: 키즈, 가족, 캐릭터, 어린이 체험 중심.
- market_flea: 마켓, 플리마켓, 야시장, 장터.
- sports_outdoor: 마라톤, 자전거, 트레일, 등산, 카약, 스포츠 대회.
- film_media: 영화제, 미디어아트, 애니메이션, 만화.
- art_exhibition: 미술, 사진, 조각, 디자인, 공예 전시·페어.
- etc: 위 카테고리 어디에도 명확히 들어가지 않을 때.`;

const LOCAL_EVENT_GUIDE = `로컬 매장 이벤트(local_event) 분류 기준:
- discount: %, 원 단위 할인, N+1, 세일.
- freebie: 무료 증정, 사이드 메뉴 무료, 음료 1잔 무료.
- new_limited: 신메뉴, 한정 메뉴, 시즌 한정 출시.
- popup: 팝업 스토어, 콜라보 행사, 일시적 입점.
- opening: 신규 오픈 기념, 그랜드 오픈, 리뉴얼 오픈.
- review_event: 리뷰/SNS 인증/해시태그 이벤트.
- seasonal: 시즌·기념일·명절(밸런타인, 핼러윈, 크리스마스 등) 한정.
- etc: 명확히 어디에도 들어가지 않을 때.`;

export function buildSystemPrompt(domain: "festival" | "local_event"): string {
  const guide = domain === "festival" ? FESTIVAL_GUIDE : LOCAL_EVENT_GUIDE;
  const enumList =
    domain === "festival"
      ? FESTIVAL_PRIMARY_CATEGORIES.join(", ")
      : LOCAL_EVENT_PRIMARY_CATEGORIES.join(", ");
  return `당신은 한국 ${domain === "festival" ? "축제" : "매장 이벤트"} 항목을 정해진 카테고리로 분류하는 어시스턴트다.
입력은 JSON 배열로 주어지며, 각 항목에 대해 다음 형식의 JSON 배열을 반환한다:
[{"id": "...", "primaryCategory": "...", "categoryTags": ["...", "..."]}]

primaryCategory 는 반드시 다음 중 하나여야 한다: ${enumList}
categoryTags 는 0~3개의 짧은 한국어 키워드 (예: "벚꽃", "야경", "할인").

${guide}

설명, 마크다운, 코드 펜스 없이 JSON 배열만 출력한다.`;
}

export function validateTaggingResult(
  domain: "festival" | "local_event",
  raw: unknown,
  knownIds: ReadonlySet<string>,
): TaggingResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed: ReadonlySet<string> =
    domain === "festival"
      ? new Set(FESTIVAL_PRIMARY_CATEGORIES)
      : new Set(LOCAL_EVENT_PRIMARY_CATEGORIES);
  const out: TaggingResult[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : null;
    const primary =
      typeof obj.primaryCategory === "string" ? obj.primaryCategory : null;
    if (!id || !knownIds.has(id) || !primary || !allowed.has(primary)) continue;
    const tagsRaw = Array.isArray(obj.categoryTags) ? obj.categoryTags : [];
    const tags = tagsRaw
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5);
    out.push({ id, primaryCategory: primary, categoryTags: tags });
  }
  return out;
}
