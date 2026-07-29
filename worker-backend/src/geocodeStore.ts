interface GeocodeCacheRow {
  query: string;
  found: number;
  lat: number | null;
  lng: number | null;
  address: string | null;
  venue: string | null;
}

export interface D1GeocodeEntry {
  found: boolean;
  lat: number | null;
  lng: number | null;
  address: string | null;
  venue: string | null;
}

// D1's bound-parameter limit is 100 per query; stay comfortably under it.
const GET_MANY_BATCH_SIZE = 90;

export function createD1GeocodeStore(db: D1Database): {
  getMany(queries: string[]): Promise<Map<string, D1GeocodeEntry>>;
  setMany(entries: Array<{ query: string; entry: D1GeocodeEntry }>): Promise<void>;
} {
  return {
    async getMany(queries) {
      const result = new Map<string, D1GeocodeEntry>();
      if (queries.length === 0) return result;
      for (let start = 0; start < queries.length; start += GET_MANY_BATCH_SIZE) {
        const batch = queries.slice(start, start + GET_MANY_BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await db
          .prepare(
            `SELECT query, found, lat, lng, address, venue
               FROM geocode_cache
              WHERE query IN (${placeholders})`
          )
          .bind(...batch)
          .all<GeocodeCacheRow>();
        for (const row of rows.results ?? []) {
          result.set(row.query, {
            found: Boolean(row.found),
            lat: row.lat,
            lng: row.lng,
            address: row.address,
            venue: row.venue
          });
        }
      }
      return result;
    },
    async setMany(entries) {
      if (entries.length === 0) return;
      const cachedAt = new Date().toISOString();
      const statements = entries.map(({ query, entry }) =>
        db
          .prepare(
            `INSERT INTO geocode_cache (query, found, lat, lng, address, venue, cached_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(query) DO UPDATE SET
               found = excluded.found,
               lat = excluded.lat,
               lng = excluded.lng,
               address = excluded.address,
               venue = excluded.venue,
               cached_at = excluded.cached_at`
          )
          .bind(query, entry.found ? 1 : 0, entry.lat, entry.lng, entry.address, entry.venue, cachedAt)
      );
      await db.batch(statements);
    }
  };
}
