import { describe, expect, it } from "vitest";
import { createD1GeocodeStore } from "../src/geocodeStore.js";

function fakeDb(rowsForQuery: (query: string) => Record<string, unknown> | null): {
  db: D1Database;
  bindCalls: unknown[][];
} {
  const bindCalls: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        bindCalls.push(args);
        return {
          all: async () => ({
            results: args
              .map((query) => rowsForQuery(String(query)))
              .filter((row): row is Record<string, unknown> => row !== null)
          })
        };
      }
    })
  } as unknown as D1Database;
  return { db, bindCalls };
}

describe("createD1GeocodeStore.getMany", () => {
  it("issues a single query when queries fit under the D1 bound-parameter limit", async () => {
    const { db, bindCalls } = fakeDb((query) => ({
      query,
      found: 1,
      lat: 36.1,
      lng: 128.4,
      address: "테스트 주소",
      venue: "테스트 장소"
    }));
    const store = createD1GeocodeStore(db);
    const queries = Array.from({ length: 90 }, (_, i) => `query-${i}`);

    const result = await store.getMany(queries);

    expect(bindCalls).toHaveLength(1);
    expect(result.size).toBe(90);
  });

  it("splits into multiple batches when queries exceed the D1 bound-parameter limit", async () => {
    const { db, bindCalls } = fakeDb((query) => ({
      query,
      found: 1,
      lat: 36.1,
      lng: 128.4,
      address: null,
      venue: null
    }));
    const store = createD1GeocodeStore(db);
    // Chungnam wave 2 sites (e.g. Gongju) produced 119 unique warmup queries.
    const queries = Array.from({ length: 119 }, (_, i) => `query-${i}`);

    const result = await store.getMany(queries);

    expect(bindCalls.length).toBeGreaterThan(1);
    expect(bindCalls.every((args) => args.length <= 90)).toBe(true);
    expect(result.size).toBe(119);
  });

  it("merges rows from every batch into one result map", async () => {
    const { db } = fakeDb((query) =>
      query === "query-5" || query === "query-95"
        ? { query, found: 1, lat: 1, lng: 2, address: null, venue: null }
        : null
    );
    const store = createD1GeocodeStore(db);
    const queries = Array.from({ length: 100 }, (_, i) => `query-${i}`);

    const result = await store.getMany(queries);

    expect(result.has("query-5")).toBe(true);
    expect(result.has("query-95")).toBe(true);
    expect(result.size).toBe(2);
  });
});
