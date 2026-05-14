import { describe, expect, it } from "vitest";
import { queryLocalEvents, updateAdminLocalEvent } from "../../worker-backend/src/localEvents.js";

describe("worker local events", () => {
  it("returns a next cursor when approved bounding-box rows exceed the requested page size", async () => {
    const outsideCircleRows = Array.from({ length: 110 }, (_, index) =>
      localEventRow(`local:outside:${index}`, index, 37.5745, 126.987)
    );
    const insideCircleRows = Array.from({ length: 40 }, (_, index) =>
      localEventRow(`local:inside:${index}`, index, 37.5665 + index * 0.000001, 126.978)
    );
    const rows = [...outsideCircleRows, ...insideCircleRows];
    const db = new MockLocalEventsD1(rows);

    const result = await queryLocalEvents(db as never, {
      lat: 37.5665,
      lng: 126.978,
      radiusMeters: 1000,
      limit: 10
    });

    expect(db.lastSelectSql).not.toMatch(/\bLIMIT\b/i);
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBe("10");
  });

  it("stores the full updated event in raw_payload for admin patches", async () => {
    const db = new MockLocalEventsD1([localEventRow("local:patch", 0)]);

    const updated = await updateAdminLocalEvent(db as never, "local:patch", {
      title: "Updated title"
    });

    expect(updated?.title).toBe("Updated title");
    expect(JSON.parse(db.lastRawPayload ?? "{}")).toMatchObject({
      id: "local:patch",
      title: "Updated title",
      benefit: "Original benefit",
      status: "approved"
    });
  });
});

function localEventRow(id: string, index: number, lat = 37.5665 + index * 0.000001, lng = 126.978) {
  return {
    id,
    title: `Event ${index}`,
    description: `Description ${index}`,
    benefit: "Original benefit",
    event_type: "discount",
    status: "approved",
    source: "admin_manual",
    source_url: null,
    source_item_id: id,
    image_url: null,
    store_name: `Store ${index}`,
    address: "Seoul",
    lat,
    lng,
    start_date: "2026-05-01",
    end_date: "2026-05-31",
    confidence_score: null,
    needs_review: 0,
    is_sponsored: 0,
    sponsor_tier: null,
    paid_until: null,
    priority_score: 0,
    updated_at: "2026-05-14T00:00:00.000Z"
  };
}

class MockLocalEventsD1 {
  lastSelectSql = "";
  lastRawPayload: string | null = null;

  constructor(private readonly rows: ReturnType<typeof localEventRow>[]) {}

  prepare(sql: string) {
    return new MockLocalEventsStatement(sql, this);
  }

  selectRows(sql: string, bindings: unknown[]) {
    this.lastSelectSql = sql;
    const rows = sql.includes("WHERE id = ?")
      ? this.rows.filter((row) => row.id === bindings[0])
      : this.rows;
    const limit = /\bLIMIT\s+\?/i.test(sql) ? Number(bindings.at(-1)) : rows.length;
    return rows.slice(0, limit);
  }

  captureInsert(bindings: unknown[]) {
    this.lastRawPayload = bindings[23] as string;
  }
}

class MockLocalEventsStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly db: MockLocalEventsD1
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async all<T>() {
    return { results: this.db.selectRows(this.sql, this.bindings) as T[] };
  }

  async first<T>() {
    return (this.db.selectRows(this.sql, this.bindings)[0] ?? null) as T | null;
  }

  async run() {
    if (/INSERT INTO local_events/i.test(this.sql)) this.db.captureInsert(this.bindings);
    return { meta: { changes: 1 } };
  }
}
