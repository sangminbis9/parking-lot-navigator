import type { ParkingSearchOptions } from "@parking/shared-types";
import type { ParkingProvider, RawParkingRecord } from "../types/provider.js";
import type { AppConfig } from "../config/env.js";
import { BaseProviderHealth } from "./BaseProviderHealth.js";

export class SeoulParkingMetadataProvider extends BaseProviderHealth implements ParkingProvider {
  readonly name = "seoul-metadata";

  constructor(private readonly config: AppConfig) {
    super("seoul-metadata");
  }

  async fetchNearby(_lat: number, _lng: number, _options: ParkingSearchOptions): Promise<RawParkingRecord[]> {
    if (!this.config.SEOUL_OPEN_DATA_KEY) {
      this.markFailure(new Error("SEOUL_OPEN_DATA_KEY가 설정되지 않았습니다."));
      return [];
    }

    try {
      // TODO(실연동): 서울시 공영주차장 안내 API로 주소, 요금, 운영시간, 총면수를 보강합니다.
      this.markSuccess(0.6);
      return [];
    } catch (error) {
      this.markFailure(error);
      return [];
    }
  }
}
