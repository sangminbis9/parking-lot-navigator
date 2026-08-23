// 관심 지역 매칭. 앱이 보내는 지역 키는 두 가지 형태뿐이다.
//
//   "서울"        광역시도 전체
//   "서울|중구"   광역시도 + 시/군/구
//
// 예전 구조는 "중구"·"고성군"처럼 이름만 저장해 주소 문자열 포함 여부로 판정했다.
// 그 방식은 서울 중구와 부산 중구, 강원 고성군과 경남 고성군을 구분하지 못해
// 중복 이름을 아예 매칭 대상에서 빼야 했고, 그만큼 알림이 통째로 누락됐다.
// 여기서는 주소에서 광역시도와 시/군/구를 따로 뽑아 둘 다 비교한다.

export const PROVINCE_SEPARATOR = "|";

// 17개 광역시도 단축명. 주소 앞머리가 이 이름으로 시작하면 그대로 쓴다
// ("서울특별시"·"경기도"·"강원특별자치도" 모두 hasPrefix로 잡힌다).
const PROVINCES = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;

// 단축명이 앞머리에 없는 옛 표기만 따로 맞춘다.
const PROVINCE_ALIASES: [string, string][] = [
  ["충청북도", "충북"],
  ["충청남도", "충남"],
  ["전라북도", "전북"],
  ["전라남도", "전남"],
  ["경상북도", "경북"],
  ["경상남도", "경남"],
];

export type ParsedRegion = { province: string | null; district: string | null };

/**
 * 주소에서 (광역시도, 시/군/구)를 뽑는다.
 * "인천광역시 연수구 송도동 …" → { province: "인천", district: "연수구" }
 * "경기도 수원시 팔달구 …"     → { province: "경기", district: "수원시" }
 *   (앱의 지역 선택 계층이 자치구가 아니라 시 단위라 첫 시/군/구를 쓴다)
 */
export function parseRegion(address: string): ParsedRegion {
  const tokens = (address ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { province: null, district: null };

  const head = tokens[0];
  let province: string | null = null;
  for (const [long, short] of PROVINCE_ALIASES) {
    if (head.startsWith(long)) {
      province = short;
      break;
    }
  }
  if (!province) {
    province = PROVINCES.find((name) => head.startsWith(name)) ?? null;
  }

  let district: string | null = null;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.length >= 2 && /[시군구]$/.test(token)) {
      district = token;
      break;
    }
  }
  return { province, district };
}

/**
 * 관심 지역 매칭. 선택된 지역이 하나도 없으면 전국 전체가 대상이므로 항상 true다.
 * (예전처럼 마지막 위치나 서울시청 기준 반경으로 좁히지 않는다.)
 */
export function matchesRegions(address: string, regions: string[]): boolean {
  if (!regions || regions.length === 0) return true;
  const parsed = parseRegion(address);
  if (!parsed.province) return false;
  return regions.some((key) => {
    const [province, district] = splitRegionKey(key);
    if (province !== parsed.province) return false;
    if (!district) return true;
    return district === parsed.district;
  });
}

export function splitRegionKey(key: string): [string, string | null] {
  const index = key.indexOf(PROVINCE_SEPARATOR);
  if (index < 0) return [key, null];
  return [key.slice(0, index), key.slice(index + 1) || null];
}
