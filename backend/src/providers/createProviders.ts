import { config } from "../config/env.js";
import type { ParkingProvider } from "../types/provider.js";
import { CompositeParkingProvider } from "./CompositeParkingProvider.js";
import { MockParkingProvider } from "./MockParkingProvider.js";
import { SeoulParkingMetadataProvider } from "./SeoulParkingMetadataProvider.js";
import { SeoulRealtimeParkingProvider } from "./SeoulRealtimeParkingProvider.js";
import { TSKoreaParkingProvider } from "./TSKoreaParkingProvider.js";

export function createCompositeParkingProvider(): CompositeParkingProvider {
  const providers: ParkingProvider[] = [];
  if (config.PARKING_PROVIDER_MODE === "mock" || config.PARKING_PROVIDER_MODE === "hybrid") {
    providers.push(new MockParkingProvider());
  }
  if (config.PARKING_PROVIDER_MODE === "real" || config.PARKING_PROVIDER_MODE === "hybrid") {
    providers.push(
      new SeoulRealtimeParkingProvider(config),
      new SeoulParkingMetadataProvider(config),
      new TSKoreaParkingProvider(config)
    );
  }
  return new CompositeParkingProvider(providers);
}
