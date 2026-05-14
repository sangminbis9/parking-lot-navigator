import type { ParkingLot } from "@parking/shared-types";
import { distanceMeters } from "../services/geo.js";

const DUPLICATE_DISTANCE_METERS = 45;
const SPATIAL_BUCKET_SIZE_DEGREES = DUPLICATE_DISTANCE_METERS / 111_320;
const SPATIAL_NEIGHBOR_RANGE = 2;

export function deduplicateParkingLots(items: ParkingLot[]): ParkingLot[] {
  const merged: ParkingLot[] = [];
  const sourceIndex = new Map<string, number>();
  const spatialIndex = new Map<string, Set<number>>();

  for (const item of items) {
    const existingIndex = findDuplicateIndex(item, merged, sourceIndex, spatialIndex);
    if (existingIndex === null) {
      merged.push(item);
      addIndexes(item, merged.length - 1, sourceIndex, spatialIndex);
      continue;
    }
    const existing = merged[existingIndex];
    const richer = chooseRicher(existing, item);
    const poorer = richer === existing ? item : existing;
    richer.provenance = [...richer.provenance, ...poorer.provenance];
    removeIndexes(existing, existingIndex, sourceIndex, spatialIndex);
    merged[existingIndex] = richer;
    addIndexes(richer, existingIndex, sourceIndex, spatialIndex);
  }
  return merged;
}

function isDuplicate(a: ParkingLot, b: ParkingLot): boolean {
  if (a.source === b.source && a.sourceParkingId === b.sourceParkingId) return true;
  const close = distanceMeters(a.lat, a.lng, b.lat, b.lng) <= DUPLICATE_DISTANCE_METERS;
  return close && similarity(normalizeName(a.name), normalizeName(b.name)) >= 0.72;
}

function findDuplicateIndex(
  item: ParkingLot,
  merged: ParkingLot[],
  sourceIndex: Map<string, number>,
  spatialIndex: Map<string, Set<number>>
): number | null {
  const sourceMatch = sourceIndex.get(sourceKey(item));
  if (sourceMatch !== undefined && isDuplicate(merged[sourceMatch], item)) return sourceMatch;

  for (const index of nearbyIndexes(item, spatialIndex)) {
    if (isDuplicate(merged[index], item)) return index;
  }
  return null;
}

function addIndexes(
  item: ParkingLot,
  index: number,
  sourceIndex: Map<string, number>,
  spatialIndex: Map<string, Set<number>>
): void {
  sourceIndex.set(sourceKey(item), index);
  const key = spatialKey(item);
  const bucket = spatialIndex.get(key);
  if (bucket) {
    bucket.add(index);
  } else {
    spatialIndex.set(key, new Set([index]));
  }
}

function removeIndexes(
  item: ParkingLot,
  index: number,
  sourceIndex: Map<string, number>,
  spatialIndex: Map<string, Set<number>>
): void {
  sourceIndex.delete(sourceKey(item));
  const key = spatialKey(item);
  const bucket = spatialIndex.get(key);
  bucket?.delete(index);
  if (bucket?.size === 0) spatialIndex.delete(key);
}

function nearbyIndexes(item: ParkingLot, spatialIndex: Map<string, Set<number>>): number[] {
  const indexes = new Set<number>();
  const { latCell, lngCell } = spatialCell(item);
  for (let latOffset = -SPATIAL_NEIGHBOR_RANGE; latOffset <= SPATIAL_NEIGHBOR_RANGE; latOffset += 1) {
    for (let lngOffset = -SPATIAL_NEIGHBOR_RANGE; lngOffset <= SPATIAL_NEIGHBOR_RANGE; lngOffset += 1) {
      const bucket = spatialIndex.get(`${latCell + latOffset}:${lngCell + lngOffset}`);
      if (!bucket) continue;
      for (const index of bucket) indexes.add(index);
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

function sourceKey(item: ParkingLot): string {
  return `${item.source}:${item.sourceParkingId}`;
}

function spatialKey(item: ParkingLot): string {
  const { latCell, lngCell } = spatialCell(item);
  return `${latCell}:${lngCell}`;
}

function spatialCell(item: ParkingLot): { latCell: number; lngCell: number } {
  return {
    latCell: Math.floor(item.lat / SPATIAL_BUCKET_SIZE_DEGREES),
    lngCell: Math.floor(item.lng / SPATIAL_BUCKET_SIZE_DEGREES)
  };
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
