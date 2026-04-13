import type { DestinationCandidate } from "@parking/shared-types";
import { config } from "../config/env.js";

export async function searchDestination(query: string): Promise<DestinationCandidate[]> {
  if (!config.KAKAO_REST_API_KEY || config.PARKING_PROVIDER_MODE === "mock") {
    return mockDestinations(query);
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
    throw new Error(`Kakao Local API 호출 실패: ${response.status}`);
  }

  const body = (await response.json()) as {
    documents?: Array<{ id: string; place_name: string; road_address_name: string; address_name: string; y: string; x: string }>;
  };

  return (body.documents ?? []).map((doc) => ({
    id: doc.id,
    name: doc.place_name,
    address: doc.road_address_name || doc.address_name,
    lat: Number(doc.y),
    lng: Number(doc.x),
    source: "kakao-local"
  }));
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
