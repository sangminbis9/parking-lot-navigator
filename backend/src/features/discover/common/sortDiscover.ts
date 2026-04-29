import type { DiscoverStatus } from "@parking/shared-types";

export function sortByStatusThenDistance<T extends { status: DiscoverStatus; distanceMeters: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "ongoing" ? -1 : 1;
    }
    return a.distanceMeters - b.distanceMeters;
  });
}

export function sortByDistance<T extends { distanceMeters: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.distanceMeters - b.distanceMeters);
}
