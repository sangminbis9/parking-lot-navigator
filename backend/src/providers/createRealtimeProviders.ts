import { config } from "../config/env.js";
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
    new IncheonAirportRealtimeParkingProvider(config),
  ]);
}
