import { config } from "../config/env.js";
import type { ParkingProvider } from "../types/provider.js";
import { CompositeParkingProvider } from "./CompositeParkingProvider.js";
import { D1ParkingProvider, type D1DatabaseLike } from "./D1ParkingProvider.js";
import { KakaoParkingProvider } from "./KakaoParkingProvider.js";
import { MockParkingProvider } from "./MockParkingProvider.js";
import {
  DaejeonRealtimeParkingProvider,
  IncheonAirportRealtimeParkingProvider,
  KacAirportRealtimeParkingProvider,
  SuseongRealtimeParkingProvider
} from "./PublicDataRealtimeParkingProviders.js";
import { SeoulParkingMetadataProvider } from "./SeoulParkingMetadataProvider.js";
import { SeoulRealtimeParkingProvider } from "./SeoulRealtimeParkingProvider.js";
import {
  SeoulHangangParkingProvider,
  SeoulSeongdongIotParkingProvider
} from "./SeoulSupplementalRealtimeParkingProviders.js";
import { TSKoreaParkingProvider } from "./TSKoreaParkingProvider.js";

export interface ProviderRuntime {
  d1?: D1DatabaseLike;
}

export function createCompositeParkingProvider(runtime: ProviderRuntime = {}): CompositeParkingProvider {
  const providers: ParkingProvider[] = [];
  if (config.PARKING_PROVIDER_MODE === "mock" || config.PARKING_PROVIDER_MODE === "hybrid") {
    providers.push(new MockParkingProvider());
  }
  if (config.PARKING_PROVIDER_MODE === "real" || config.PARKING_PROVIDER_MODE === "hybrid") {
    const nationalProviders: ParkingProvider[] = runtime.d1 ? [new D1ParkingProvider(runtime.d1)] : [];
    providers.push(
      new SeoulRealtimeParkingProvider(config),
      new SeoulParkingMetadataProvider(config),
      new SeoulSeongdongIotParkingProvider(config),
      new SeoulHangangParkingProvider(config),
      new DaejeonRealtimeParkingProvider(config),
      new SuseongRealtimeParkingProvider(config),
      new KacAirportRealtimeParkingProvider(config),
      new IncheonAirportRealtimeParkingProvider(config),
      ...nationalProviders,
      new TSKoreaParkingProvider(config),
      new KakaoParkingProvider(config)
    );
  }
  return new CompositeParkingProvider(providers);
}

export function createRealtimeParkingProvider(): CompositeParkingProvider {
  if (config.PARKING_PROVIDER_MODE === "mock") {
    return new CompositeParkingProvider([new MockParkingProvider()]);
  }

  return new CompositeParkingProvider([
    new SeoulRealtimeParkingProvider(config),
    new SeoulParkingMetadataProvider(config),
    new SeoulSeongdongIotParkingProvider(config),
    new SeoulHangangParkingProvider(config),
    new DaejeonRealtimeParkingProvider(config),
    new SuseongRealtimeParkingProvider(config),
    new KacAirportRealtimeParkingProvider(config),
    new IncheonAirportRealtimeParkingProvider(config)
  ]);
}
