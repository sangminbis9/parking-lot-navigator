import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

export class TSKoreaParkingProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "ts-korea";

  constructor(private readonly config: AppConfig) {
    super("ts-korea");
  }

  async fetchNearby(_lat: number, _lng: number, _options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.PUBLIC_DATA_SERVICE_KEY) {
      this.markFailure(new Error("PUBLIC_DATA_SERVICE_KEY가 설정되지 않았습니다."));
      return [];
    }

    try {
      // TODO(실연동): 한국교통안전공단 주차정보 API의 개발/운영 endpoint와 serviceKey 인코딩 정책을 확정합니다.
      this.markSuccess(0.55);
      return [];
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}
