import { randomUUID } from "node:crypto";
import type {
  CreateSearchHistoryRequest,
  SearchHistoryRecord,
  SearchHistoryStatsResponse
} from "@parking/shared-types";
import { normalizePlaceCategory } from "./categoryNormalization.js";
import type { SearchHistoryRepository } from "./SearchHistoryRepository.js";

export class SearchHistoryService {
  constructor(private readonly repository: SearchHistoryRepository) {}

  async create(input: CreateSearchHistoryRequest): Promise<SearchHistoryRecord> {
    const normalizedCategory =
      input.normalizedCategory ??
      normalizePlaceCategory(input.rawCategory, `${input.destinationName} ${input.address}`);

    return this.repository.create({
      id: randomUUID(),
      deviceId: input.deviceId,
      userId: input.userId ?? null,
      queryText: input.queryText.trim().slice(0, 120),
      destinationId: input.destinationId ?? null,
      destinationName: input.destinationName,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      selectedAt: input.selectedAt ?? new Date().toISOString(),
      normalizedCategory,
      rawCategory: input.rawCategory ?? null,
      provider: input.provider ?? null
    });
  }

  async list(deviceId?: string): Promise<SearchHistoryRecord[]> {
    return this.repository.list(deviceId);
  }

  async stats(deviceId?: string): Promise<SearchHistoryStatsResponse> {
    const records = await this.repository.list(deviceId);
    const categoryCounts = new Map<string, number>();
    const destinationCounts = new Map<string, SearchHistoryStatsResponse["repeatedDestinations"][number]>();

    for (const record of records) {
      categoryCounts.set(record.normalizedCategory, (categoryCounts.get(record.normalizedCategory) ?? 0) + 1);
      const key = record.destinationId ?? `${record.destinationName}|${record.address}`;
      const current = destinationCounts.get(key);
      if (!current) {
        destinationCounts.set(key, {
          destinationId: record.destinationId,
          destinationName: record.destinationName,
          address: record.address,
          lat: record.lat,
          lng: record.lng,
          count: 1,
          lastSelectedAt: record.selectedAt
        });
      } else {
        current.count += 1;
        if (record.selectedAt > current.lastSelectedAt) {
          current.lastSelectedAt = record.selectedAt;
        }
      }
    }

    return {
      topCategories: [...categoryCounts.entries()]
        .map(([category, count]) => ({ category: category as SearchHistoryRecord["normalizedCategory"], count }))
        .sort((a, b) => b.count - a.count),
      repeatedDestinations: [...destinationCounts.values()]
        .filter((item) => item.count > 1)
        .sort((a, b) => b.count - a.count || b.lastSelectedAt.localeCompare(a.lastSelectedAt)),
      generatedAt: new Date().toISOString()
    };
  }
}
