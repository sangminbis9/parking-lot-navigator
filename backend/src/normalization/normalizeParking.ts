import type { ParkingLot } from "@parking/shared-types";
import type { RawParkingRecord } from "../types/provider.js";
import { distanceMeters } from "../services/geo.js";

export function isStale(freshnessTimestamp: string | null | undefined, thresholdSeconds: number): boolean {
  if (!freshnessTimestamp) return false;
  const timestamp = new Date(freshnessTimestamp).getTime();
  if (Number.isNaN(timestamp)) return true;
  return Date.now() - timestamp > thresholdSeconds * 1000;
}

export function normalizeParkingRecord(
  raw: RawParkingRecord,
  destinationLat: number,
  destinationLng: number,
  staleThresholdSeconds: number
): ParkingLot {
  const totalCapacity = raw.totalCapacity ?? null;
  const availableSpaces = raw.availableSpaces ?? null;
  const occupancyRate =
    totalCapacity !== null && totalCapacity > 0 && availableSpaces !== null
      ? Math.max(0, Math.min(1, 1 - availableSpaces / totalCapacity))
      : null;
  const stale = isStale(raw.freshnessTimestamp, staleThresholdSeconds);
  const realtimeAvailable = Boolean(raw.realtimeAvailable && !stale);
  const congestionStatus = raw.congestionStatus ?? inferCongestion(availableSpaces, occupancyRate);

  return {
    id: `${raw.source}:${raw.sourceParkingId}`,
    source: raw.source,
    sourceParkingId: raw.sourceParkingId,
    name: raw.name,
    address: raw.address ?? "주소 정보 없음",
    lat: raw.lat,
    lng: raw.lng,
    distanceFromDestinationMeters: distanceMeters(destinationLat, destinationLng, raw.lat, raw.lng),
    totalCapacity,
    availableSpaces,
    occupancyRate,
    congestionStatus,
    realtimeAvailable,
    freshnessTimestamp: raw.freshnessTimestamp ?? null,
    operatingHours: raw.operatingHours ?? null,
    feeSummary: raw.feeSummary ?? null,
    supportsEv: raw.supportsEv ?? false,
    supportsAccessible: raw.supportsAccessible ?? false,
    isPublic: raw.isPublic ?? false,
    isPrivate: raw.isPrivate ?? false,
    stale,
    displayStatus: displayStatus({ realtimeAvailable, stale, availableSpaces, congestionStatus }),
    score: 0,
    provenance: [
      {
        source: raw.source,
        sourceParkingId: raw.sourceParkingId,
        freshnessTimestamp: raw.freshnessTimestamp ?? null
      }
    ],
    rawSourcePayload: raw.rawSourcePayload
  };
}

function inferCongestion(
  availableSpaces: number | null,
  occupancyRate: number | null
): ParkingLot["congestionStatus"] {
  if (occupancyRate !== null) {
    if (occupancyRate >= 0.98) return "full";
    if (occupancyRate >= 0.85) return "busy";
    if (occupancyRate >= 0.6) return "moderate";
    return "available";
  }
  if (availableSpaces !== null) return availableSpaces <= 2 ? "busy" : "available";
  return "unknown";
}

function displayStatus(input: {
  realtimeAvailable: boolean;
  stale: boolean;
  availableSpaces: number | null;
  congestionStatus: ParkingLot["congestionStatus"];
}): string {
  if (input.stale) return "업데이트 지연 가능";
  if (input.realtimeAvailable && input.availableSpaces !== null) return `실시간 ${input.availableSpaces}면`;
  if (input.congestionStatus !== "unknown") return congestionLabel(input.congestionStatus);
  return "실시간 정보 없음";
}

function congestionLabel(status: ParkingLot["congestionStatus"]): string {
  switch (status) {
    case "available":
      return "여유";
    case "moderate":
      return "보통";
    case "busy":
      return "혼잡";
    case "full":
      return "만차 임박";
    default:
      return "실시간 정보 없음";
  }
}
