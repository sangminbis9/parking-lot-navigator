import type { DestinationCandidate } from "@parking/shared-types";
import { config } from "../config/env.js";
import { normalizePlaceCategory } from "../features/analytics/categoryNormalization.js";

export async function searchDestination(query: string): Promise<DestinationCandidate[]> {
  if (config.PARKING_PROVIDER_MODE === "mock") {
    return mockDestinations(query);
  }

  // 운영 모드에서 mock으로 내려가면 "검색 실패"가 "엉뚱한 서울 좌표"로 둔갑한다.
  if (!config.KAKAO_REST_API_KEY) {
    throw new DestinationSearchUnavailableError("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
  }

  const url = new URL("/v2/local/search/keyword.json", config.KAKAO_LOCAL_BASE_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "10");

  const response = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${config.KAKAO_REST_API_KEY}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn("Kakao Local API 호출 실패", { status: response.status, errorText });
    throw new DestinationSearchUnavailableError(`Kakao Local API 호출 실패 (status ${response.status})`);
  }

  const body = (await response.json()) as {
    documents?: Array<{
      id: string;
      place_name: string;
      road_address_name: string;
      address_name: string;
      y: string;
      x: string;
      category_group_name?: string;
      category_name?: string;
    }>;
  };

  return (body.documents ?? []).map((doc) => ({
    id: doc.id,
    name: doc.place_name,
    address: doc.road_address_name || doc.address_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
    source: "kakao-local",
    rawCategory: doc.category_name || doc.category_group_name || null,
    normalizedCategory: normalizePlaceCategory(doc.category_name || doc.category_group_name, doc.place_name)
  }));
}

export class DestinationSearchUnavailableError extends Error {
  readonly code = "destination_search_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "DestinationSearchUnavailableError";
  }
}

function mockDestinations(query: string): DestinationCandidate[] {
  return [
    {
      id: "dest-seoul-station",
      name: query || "서울역",
      address: "서울 중구 한강대로 405",
      lat: 37.5547,
      lng: 126.9706,
      source: "mock"
    },
    {
      id: "dest-cityhall",
      name: "서울시청",
      address: "서울 중구 세종대로 110",
      lat: 37.5663,
      lng: 126.9779,
      source: "mock"
    }
  ];
}
