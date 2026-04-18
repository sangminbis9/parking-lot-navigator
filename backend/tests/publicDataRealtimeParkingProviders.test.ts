import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import {
  DaejeonRealtimeParkingProvider,
  IncheonAirportRealtimeParkingProvider,
  KacAirportRealtimeParkingProvider
} from "../src/providers/PublicDataRealtimeParkingProviders.js";

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 4000,
  HOST: "0.0.0.0",
  LOG_LEVEL: "silent",
  PARKING_PROVIDER_MODE: "real",
  DEFAULT_SEARCH_RADIUS_METERS: 800,
  DEFAULT_DISCOVER_RADIUS_METERS: 20000,
  STALE_THRESHOLD_SECONDS: 600,
  CACHE_TTL_SECONDS: 60,
  DISCOVER_CACHE_TTL_SECONDS: 21600,
  FESTIVAL_PROVIDER_ENABLED: true,
  EVENT_PROVIDER_ENABLED: true,
  KAKAO_REST_API_KEY: "test-kakao",
  KAKAO_LOCAL_BASE_URL: "https://dapi.kakao.com",
  SEOUL_OPEN_DATA_KEY: "test-seoul",
  SEOUL_OPEN_DATA_BASE_URL: "http://openapi.seoul.go.kr:8088",
  PUBLIC_DATA_SERVICE_KEY: "test-public",
  PUBLIC_DATA_ENV: "development",
  PUBLIC_DATA_BASE_URL: "https://apis.data.go.kr"
};

describe("public data realtime parking providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Daejeon realtime parking XML into nearby realtime records", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `<response><body><items><item>
          <name>대전역 서광장 주차장</name>
          <lat>36.3323</lat>
          <lon>127.4340</lon>
          <address>대전 동구 중앙로 215</address>
          <totalQty>100</totalQty>
          <resQty>23</resQty>
          <type>유료</type>
          <baseTime>30</baseTime>
          <baseRate>1000</baseRate>
          <addTime>10</addTime>
          <addRate>300</addRate>
          <weekdayOpenTime>09:00</weekdayOpenTime>
          <weekdayCloseTime>22:00</weekdayCloseTime>
        </item></items><totalCount>1</totalCount></body></response>`,
        { status: 200, headers: { "Content-Type": "application/xml" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const records = await new DaejeonRealtimeParkingProvider(config).fetchNearby(36.332, 127.434, {
      radiusMeters: 1000
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "daejeon-realtime",
      name: "대전역 서광장 주차장",
      totalCapacity: 100,
      availableSpaces: 23,
      realtimeAvailable: true,
      feeSummary: "기본 30분 1,000원, 추가 10분 300원",
      operatingHours: "평일 09:00-22:00"
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/6300000/pis/parkinglotIF");
    expect(url.searchParams.get("numOfRows")).toBe("50");
  });

  it("maps KAC airport realtime XML into airport parking records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<response><body><items><item>
            <aprKor>김포국제공항</aprKor>
            <aprEng>GIMPO INTERNATIONAL AIRPORT</aprEng>
            <parkingAirportCodeName>국내선 제1주차장</parkingAirportCodeName>
            <parkingFullSpace>2320</parkingFullSpace>
            <parkingIstay>2125</parkingIstay>
            <parkingGetdate>2026-04-18</parkingGetdate>
            <parkingGettime>14:38:00</parkingGettime>
          </item></items></body></response>`,
          { status: 200, headers: { "Content-Type": "application/xml" } }
        )
      )
    );

    const records = await new KacAirportRealtimeParkingProvider(config).fetchNearby(37.5583, 126.7906, {
      radiusMeters: 1000
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "kac-airport-realtime",
      name: "김포국제공항 국내선 제1주차장",
      totalCapacity: 2320,
      availableSpaces: 195,
      realtimeAvailable: true
    });
  });

  it("maps Incheon airport JSON into terminal parking records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            response: {
              body: {
                items: {
                  item: [
                    {
                      floor: "T1 장기 P1 주차장",
                      parking: 590,
                      parkingarea: 2762,
                      datetm: "20260418143024.804"
                    }
                  ]
                }
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const records = await new IncheonAirportRealtimeParkingProvider(config).fetchNearby(37.4495, 126.451, {
      radiusMeters: 1000
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "incheon-airport-realtime",
      name: "인천국제공항 T1 장기 P1 주차장",
      totalCapacity: 2762,
      availableSpaces: 2172,
      realtimeAvailable: true
    });
  });
});
