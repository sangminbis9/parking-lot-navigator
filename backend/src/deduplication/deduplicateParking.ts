import type { ParkingLot } from "@parking/shared-types";
import { distanceMeters } from "../services/geo.js";

export function deduplicateParkingLots(items: ParkingLot[]): ParkingLot[] {
  const merged: ParkingLot[] = [];
  for (const item of items) {
    const existing = merged.find((candidate) => isDuplicate(candidate, item));
    if (!existing) {
      merged.push(item);
      continue;
    }
    const richer = chooseRicher(existing, item);
    const poorer = richer === existing ? item : existing;
    richer.provenance = [...richer.provenance, ...poorer.provenance];
    const index = merged.indexOf(existing);
    merged[index] = richer;
  }
  return merged;
}

function isDuplicate(a: ParkingLot, b: ParkingLot): boolean {
  if (a.source === b.source && a.sourceParkingId === b.sourceParkingId) return true;
  const close = distanceMeters(a.lat, a.lng, b.lat, b.lng) <= 45;
  return close && similarity(normalizeName(a.name), normalizeName(b.name)) >= 0.72;
}

function chooseRicher(a: ParkingLot, b: ParkingLot): ParkingLot {
  const aScore = richness(a);
  const bScore = richness(b);
  return bScore > aScore ? b : a;
}

function richness(item: ParkingLot): number {
  return [
    item.realtimeAvailable ? 4 : 0,
    item.availableSpaces !== null ? 3 : 0,
    item.totalCapacity !== null ? 2 : 0,
    item.feeSummary ? 1 : 0,
    item.operatingHours ? 1 : 0,
    item.stale ? -3 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, "").replace(/주차장|공영|민영/g, "").toLowerCase();
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const aSet = new Set([...a]);
  const bSet = new Set([...b]);
  const intersection = [...aSet].filter((char) => bSet.has(char)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}
