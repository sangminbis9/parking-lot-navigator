import { config } from "../config/env.js";
import type { ParkingProvider } from "../types/provider.js";
import { CompositeParkingProvider } from "./CompositeParkingProvider.js";
import { MockParkingProvider } from "./MockParkingProvider.js";
import {
  DaejeonRealtimeParkingProvider,
  IncheonAirportRealtimeParkingProvider,
  KacAirportRealtimeParkingProvider,
  SuseongRealtimeParkingProvider,
} from "./PublicDataRealtimeParkingProviders.js";
import { SeoulParkingMetadataProvider } from "./SeoulParkingMetadataProvider.js";
import { SeoulRealtimeParkingProvider } from "./SeoulRealtimeParkingProvider.js";
import {
  SeoulHangangParkingProvider,
  SeoulSeongdongIotParkingProvider,
} from "./SeoulSupplementalRealtimeParkingProviders.js";

/**
 * 실시간 주차 provider를 shard로 나눈 그룹. Worker가 한 invocation에 그룹 하나만
 * 돌려 CPU 10ms / subrequest 50건 예산을 그룹 단위로 쓰게 한다.
 *
 * 서울 4종을 한 그룹에 묶어 둔 것은 성능이 아니라 정확성 때문이다.
 * CompositeParkingProvider.mergeRawRecords가 이 넷을 `seoul:<sourceParkingId>`
 * 한 키로 합치고, mergeCoordinates가 그 병합 쌍에서 비근사 좌표를 고른다.
 * 갈라놓으면 SeoulParkingMetadataProvider의 정확 좌표가 SeoulRealtimeParkingProvider
 * 행에 닿지 못해 Kakao 지오코딩 근사 좌표가 이겨 버린다.
 */
function realtimeProviderShardGroups(): ParkingProvider[][] {
  if (config.PARKING_PROVIDER_MODE === "mock") {
    return [[new MockParkingProvider()]];
  }
  return [
    [
      new SeoulRealtimeParkingProvider(config),
      new SeoulParkingMetadataProvider(config),
      new SeoulSeongdongIotParkingProvider(config),
      new SeoulHangangParkingProvider(config),
    ],
    [new DaejeonRealtimeParkingProvider(config)],
    [new SuseongRealtimeParkingProvider(config)],
    [
      new KacAirportRealtimeParkingProvider(config),
      new IncheonAirportRealtimeParkingProvider(config),
    ],
  ];
}

export function createRealtimeParkingProviderShards(): CompositeParkingProvider[] {
  return realtimeProviderShardGroups().map((group) => new CompositeParkingProvider(group));
}

export function createRealtimeParkingProvider(): CompositeParkingProvider {
  return new CompositeParkingProvider(realtimeProviderShardGroups().flat());
}
