import type { PlaceCategory } from "@parking/shared-types";

const categoryRules: Array<{ category: PlaceCategory; keywords: string[] }> = [
  { category: "restaurant", keywords: ["restaurant", "food", "dining", "음식", "식당", "맛집", "한식", "중식", "일식", "양식", "분식"] },
  { category: "cafe", keywords: ["cafe", "coffee", "카페", "커피", "디저트"] },
  { category: "tourist_spot", keywords: ["tour", "attraction", "관광", "명소", "공원", "박물관", "미술관", "궁", "전시"] },
  { category: "shopping", keywords: ["shopping", "mall", "store", "쇼핑", "백화점", "아울렛", "마트", "상점"] },
  { category: "hospital", keywords: ["hospital", "clinic", "medical", "병원", "의원", "약국"] },
  { category: "office", keywords: ["office", "company", "business", "오피스", "회사", "빌딩", "업무"] },
  { category: "market", keywords: ["market", "시장", "전통시장"] },
  { category: "station", keywords: ["station", "terminal", "subway", "역", "터미널", "정류장"] },
  { category: "hotel", keywords: ["hotel", "motel", "stay", "호텔", "숙박", "리조트", "펜션"] },
  { category: "school", keywords: ["school", "university", "academy", "학교", "대학교", "학원"] }
];

export function normalizePlaceCategory(rawCategory?: string | null, fallbackText = ""): PlaceCategory {
  const haystack = `${rawCategory ?? ""} ${fallbackText}`.toLowerCase();
  for (const rule of categoryRules) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return rule.category;
    }
  }
  return "other";
}
