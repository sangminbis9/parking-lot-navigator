import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

export class SeoulRealtimeParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "seoul-realtime";

  constructor(private readonly config: AppConfig) {
    super("seoul-realtime");
  }

  async fetchNearby(_lat: number, _lng: number, _options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.SEOUL_OPEN_DATA_KEY) {
      this.markFailure(new Error("SEOUL_OPEN_DATA_KEY가 설정되지 않았습니다."));
      return [];
    }

    try {
      // TODO(실연동): 서울 열린데이터광장 시영주차장 실시간 주차대수 API URL과 응답 필드를 확정해 매핑합니다.
      // 현재는 인증키와 endpoint wiring을 검증할 수 있도록 빈 배열을 반환합니다.
      this.markSuccess(0.65);
      return [];
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}
