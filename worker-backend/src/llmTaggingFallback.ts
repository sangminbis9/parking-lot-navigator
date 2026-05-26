import type {
  FestivalPrimaryCategory,
  LocalEventPrimaryCategory,
  TaggingInput,
  TaggingResult,
} from "./llmTaggingSchema.js";

const FESTIVAL_RULES: Array<{
  pattern: RegExp;
  category: FestivalPrimaryCategory;
  tag?: string;
}> = [
  { pattern: /불꽃|불꽃놀이|fireworks/i, category: "light_night", tag: "불꽃" },
  { pattern: /야경|빛|조명|미디어\s*파사드|루미나리에/i, category: "light_night", tag: "야경" },
  { pattern: /벚꽃|벚나무|cherry\s*blossom/i, category: "nature_flower", tag: "벚꽃" },
  { pattern: /장미|튤립|유채|국화|단풍|꽃|억새|연꽃/, category: "nature_flower", tag: "꽃" },
  { pattern: /콘서트|페스티벌|festival|edm|록|재즈|클래식|국악|k-?pop/i, category: "music_performance", tag: "공연" },
  { pattern: /와인|맥주|막걸리|커피|푸드|food|먹거리|미식|음식/i, category: "food_drink", tag: "먹거리" },
  { pattern: /전통|민속|향토|제례|사찰|문화재/, category: "tradition_culture", tag: "전통" },
  { pattern: /키즈|어린이|가족|kids|family|캐릭터/i, category: "family_kids", tag: "가족" },
  { pattern: /마켓|플리\s*마켓|야시장|장터|market/i, category: "market_flea", tag: "마켓" },
  { pattern: /마라톤|자전거|트레일|등산|카약|스포츠|sport/i, category: "sports_outdoor", tag: "스포츠" },
  { pattern: /영화제|미디어아트|애니메이션|film|cinema/i, category: "film_media", tag: "영화" },
  { pattern: /미술|사진|조각|디자인|공예|전시|exhibition/i, category: "art_exhibition", tag: "전시" },
];

const LOCAL_EVENT_RULES: Array<{
  pattern: RegExp;
  category: LocalEventPrimaryCategory;
  tag?: string;
}> = [
  { pattern: /무료|free|증정|드림|드려요/i, category: "freebie", tag: "무료" },
  { pattern: /%|할인|세일|sale|N\+1|1\+1/i, category: "discount", tag: "할인" },
  { pattern: /신메뉴|한정|new|limited|시즌\s*한정/i, category: "new_limited", tag: "신메뉴" },
  { pattern: /팝업|pop[-\s]?up|콜라보/i, category: "popup", tag: "팝업" },
  { pattern: /오픈|grand\s*open|리뉴얼|신규/i, category: "opening", tag: "오픈" },
  { pattern: /리뷰|인증|해시태그|sns/i, category: "review_event", tag: "리뷰" },
  { pattern: /밸런타인|화이트데이|크리스마스|핼러윈|할로윈|설|추석/, category: "seasonal", tag: "시즌" },
];

export function fallbackTag(input: TaggingInput): TaggingResult {
  const text = [
    input.title,
    input.subtitle,
    input.categoryText,
    input.benefit,
    input.description,
    input.tagsHint,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ");

  if (input.domain === "festival") {
    if (input.source === "kopis") {
      return {
        id: input.id,
        primaryCategory: "music_performance",
        categoryTags: ["공연"],
      };
    }
    for (const rule of FESTIVAL_RULES) {
      if (rule.pattern.test(text)) {
        return {
          id: input.id,
          primaryCategory: rule.category,
          categoryTags: rule.tag ? [rule.tag] : [],
        };
      }
    }
    return { id: input.id, primaryCategory: "etc", categoryTags: [] };
  }

  for (const rule of LOCAL_EVENT_RULES) {
    if (rule.pattern.test(text)) {
      return {
        id: input.id,
        primaryCategory: rule.category,
        categoryTags: rule.tag ? [rule.tag] : [],
      };
    }
  }
  return { id: input.id, primaryCategory: "etc", categoryTags: [] };
}
