export type DiscoverySyncKind = "festivals" | "events";

export const DISCOVERY_PROVIDER_CHUNKS: Array<{
  kind: DiscoverySyncKind;
  providers: string[];
}> = [
  { kind: "festivals", providers: ["tourapi-festival"] },
  { kind: "festivals", providers: ["public-data-culture-festival"] },
  { kind: "festivals", providers: ["tourapi-area-festival"] },
  { kind: "festivals", providers: ["tourapi-keyword-festival"] },
  { kind: "events", providers: ["seoul-culture-event"] },
  { kind: "events", providers: ["culture-portal"] },
  { kind: "events", providers: ["kopis"] },
  { kind: "events", providers: ["kcisa_428"] },
  { kind: "events", providers: ["kcisa_196"] },
];

export const DISCOVERY_PROVIDER_CHUNK_COUNT =
  DISCOVERY_PROVIDER_CHUNKS.length;

export function currentDiscoveryChunkIndex(date: Date = new Date()): number {
  const slotsPerHour = 7;
  const slot =
    date.getUTCHours() * slotsPerHour + Math.floor(date.getUTCMinutes() / 9);
  return slot % DISCOVERY_PROVIDER_CHUNK_COUNT;
}
