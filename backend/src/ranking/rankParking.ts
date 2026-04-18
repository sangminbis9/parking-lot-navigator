import type { ParkingLot, ParkingSearchOptions } from "@parking/shared-types";
import { defaultRankingWeights, type RankingWeights } from "./rankingConfig.js";

const DESTINATION_PARKING_THRESHOLD_METERS = 100;

export function rankParkingLots(
  items: ParkingLot[],
  options: ParkingSearchOptions,
  weights: RankingWeights = defaultRankingWeights
): ParkingLot[] {
  return items
    .filter((item) => !options.evOnly || item.supportsEv)
    .filter((item) => !options.accessibleOnly || item.supportsAccessible)
    .map((item) => ({ ...item, score: scoreParkingLot(item, options, weights) }))
    .sort(compareParkingLots);
}

export function scoreParkingLot(
  item: ParkingLot,
  options: ParkingSearchOptions,
  weights: RankingWeights = defaultRankingWeights
): number {
  const distanceScore = clamp(1 - item.distanceFromDestinationMeters / options.radiusMeters);
  const realtimeScore = item.realtimeAvailable ? 1 : item.freshnessTimestamp ? 0.45 : 0.15;
  const availabilityScore = availability(item);
  const freshnessScore = item.stale ? 0.1 : item.freshnessTimestamp ? 1 : 0.35;
  const feeScore = item.feeSummary?.includes("무료") ? 1 : item.feeSummary ? 0.55 : 0.4;
  const publicScore = options.preferPublic ? (item.isPublic ? 1 : 0.35) : 0.6;
  const evScore = item.supportsEv ? 1 : 0.2;
  const accessibleScore = item.supportsAccessible ? 1 : 0.4;
  const walkingScore = options.bestWalkingDistanceBias ? distanceScore : 0.5;

  return round(
    distanceScore * weights.distance +
      realtimeScore * weights.realtimeConfidence +
      availabilityScore * weights.availability +
      freshnessScore * weights.freshness +
      feeScore * weights.fee +
      publicScore * weights.publicPreference +
      evScore * weights.ev +
      accessibleScore * weights.accessible +
      walkingScore * weights.walkingDistance
  );
}

function availability(item: ParkingLot): number {
  if (item.availableSpaces !== null && item.totalCapacity !== null) {
    return clamp(item.availableSpaces / Math.max(item.totalCapacity, 1));
  }
  if (item.availableSpaces !== null) return item.availableSpaces > 10 ? 0.9 : item.availableSpaces > 3 ? 0.6 : 0.25;
  switch (item.congestionStatus) {
    case "available":
      return 0.9;
    case "moderate":
      return 0.6;
    case "busy":
      return 0.25;
    case "full":
      return 0.05;
    default:
      return 0.2;
  }
}

function compareParkingLots(a: ParkingLot, b: ParkingLot): number {
  const aAtDestination = isDestinationParking(a);
  const bAtDestination = isDestinationParking(b);
  if (aAtDestination !== bAtDestination) return aAtDestination ? -1 : 1;
  return b.score - a.score;
}

function isDestinationParking(item: ParkingLot): boolean {
  return item.distanceFromDestinationMeters <= DESTINATION_PARKING_THRESHOLD_METERS;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
