/// 조건부 쓰기 테스트용 최소 D1 흉내. 실제 쓰기 문장 수를 세는 게 목적이라
/// SQL을 전부 해석하지 않고 이 저장소가 실제로 발행하는 문장 모양만 처리한다.
export interface FakeStatement {
  sql: string;
  args: unknown[];
}

export class FakeD1 {
  rows = new Map<string, Record<string, unknown>>();
  statements: FakeStatement[] = [];

  constructor(private readonly columns: string[]) {}

  /// 행을 다시 쓰는 문장 수(INSERT/UPDATE). SELECT와 prune DELETE는 제외한다 —
  /// 지울 행이 없는 DELETE는 쓰기 예산을 쓰지 않는다.
  get writes(): number {
    return this.statements.filter((s) => {
      const sql = s.sql.trimStart();
      return sql.startsWith("INSERT") || sql.startsWith("UPDATE");
    }).length;
  }

  reset(): void {
    this.statements = [];
  }

  count(kind: "insert" | "heartbeat" | "coordinate" | "delete"): number {
    return this.statements.filter((s) => {
      const sql = s.sql.trimStart();
      if (kind === "insert") return sql.startsWith("INSERT");
      if (kind === "delete") return sql.startsWith("DELETE");
      if (kind === "coordinate")
        return sql.startsWith("UPDATE") && sql.includes("SET lat = ?");
      return sql.startsWith("UPDATE") && sql.includes("last_seen_at = ?");
    }).length;
  }

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        const stmt: FakeStatement = { sql, args };
        return {
          ...stmt,
          all: async () => db.run(stmt),
          run: async () => db.run(stmt),
          first: async () => (await db.run(stmt)).results[0] ?? null,
        };
      },
    };
  }

  async batch(statements: Array<{ sql: string; args: unknown[] }>) {
    const out = [];
    for (const stmt of statements) out.push(await this.run(stmt));
    return out;
  }

  async run(stmt: { sql: string; args: unknown[] }) {
    this.statements.push({ sql: stmt.sql, args: stmt.args });
    const sql = stmt.sql.trimStart();
    if (sql.startsWith("SELECT")) {
      const ids = new Set(stmt.args as string[]);
      const results = [...this.rows.values()].filter((row) =>
        ids.has(row.id as string),
      );
      return { results, meta: { changes: 0 } };
    }
    if (sql.startsWith("INSERT")) {
      const incoming: Record<string, unknown> = {};
      this.columns.forEach((col, i) => {
        incoming[col] = stmt.args[i] ?? null;
      });
      const id = incoming.id as string;
      const existing = this.rows.get(id);
      // 실제 upsert의 first_seen_at 보존만 흉내낸다. 나머지 CASE/COALESCE 머지는
      // 이 테스트들이 의존하지 않는다.
      this.rows.set(
        id,
        existing
          ? { ...existing, ...incoming, first_seen_at: existing.first_seen_at }
          : incoming,
      );
      return { results: [], meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE")) {
      const id = stmt.args[stmt.args.length - 1] as string;
      const row = this.rows.get(id);
      if (!row) return { results: [], meta: { changes: 0 } };
      const assigned = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]);
      assigned.forEach((col, i) => {
        row[col] = stmt.args[i] ?? null;
      });
      return { results: [], meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE")) {
      const cutoff = stmt.args[stmt.args.length - 1] as string;
      const type = sql.includes("type = ?") ? (stmt.args[0] as string) : null;
      let changes = 0;
      for (const [id, row] of [...this.rows.entries()]) {
        if (type !== null && row.type !== type) continue;
        if ((row.last_seen_at as string) < cutoff) {
          this.rows.delete(id);
          changes += 1;
        }
      }
      return { results: [], meta: { changes } };
    }
    throw new Error(`FakeD1: unsupported SQL ${sql.slice(0, 40)}`);
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

export const DISCOVERY_COLUMNS = [
  "id", "type", "source", "source_item_id", "title", "subtitle",
  "category_text", "start_date", "end_date", "status", "is_free",
  "venue_name", "address", "lat", "lng", "rating", "review_count",
  "lowest_price_text", "lowest_price_platform", "source_url", "image_url",
  "images_json", "tags_json", "amenities_json", "offers_json", "raw_payload",
  "data_updated_at", "primary_category", "tagging_version", "first_seen_at",
  "last_seen_at", "synced_at",
];

export const REALTIME_COLUMNS = [
  "id", "source", "source_parking_id", "name", "address", "lat", "lng",
  "total_capacity", "available_spaces", "occupancy_rate", "congestion_status",
  "realtime_available", "freshness_timestamp", "operating_hours", "fee_summary",
  "supports_ev", "supports_accessible", "is_public", "is_private",
  "display_status", "raw_payload", "first_seen_at", "last_seen_at", "updated_at",
];
