import type { SearchHistoryRecord } from "@parking/shared-types";

const MAX_IN_MEMORY_SEARCH_HISTORY_RECORDS = 10_000;

export interface SearchHistoryRepository {
  create(record: SearchHistoryRecord): Promise<SearchHistoryRecord>;
  list(deviceId?: string): Promise<SearchHistoryRecord[]>;
}

export class InMemorySearchHistoryRepository implements SearchHistoryRepository {
  private readonly records: SearchHistoryRecord[] = [];

  async create(record: SearchHistoryRecord): Promise<SearchHistoryRecord> {
    this.records.unshift(record);
    if (this.records.length > MAX_IN_MEMORY_SEARCH_HISTORY_RECORDS) {
      this.records.length = MAX_IN_MEMORY_SEARCH_HISTORY_RECORDS;
    }
    return record;
  }

  async list(deviceId?: string): Promise<SearchHistoryRecord[]> {
    if (!deviceId) return [...this.records];
    return this.records.filter((record) => record.deviceId === deviceId);
  }
}

export const searchHistoryRepository = new InMemorySearchHistoryRepository();
