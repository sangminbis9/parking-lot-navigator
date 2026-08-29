import { describe, expect, it } from "vitest";
import { createEventReport, eventReportSchema } from "../src/eventReports.js";

function fakeDb() {
  const statements: { sql: string; args: unknown[] }[] = [];
  const db = {
    statements,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            statements.push({ sql, args });
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  };
  return db as unknown as D1Database & {
    statements: { sql: string; args: unknown[] }[];
  };
}

describe("eventReportSchema", () => {
  it("정해진 사유만 받는다", () => {
    expect(() =>
      eventReportSchema.parse({
        eventKind: "festival",
        eventId: "abc",
        reason: "made_up_reason",
      }),
    ).toThrow();
  });

  it("신고자 식별 필드는 받지 않는다", () => {
    const parsed = eventReportSchema.parse({
      eventKind: "local_event",
      eventId: "abc",
      reason: "ended",
      deviceId: "device-1",
      email: "a@b.c",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "eventId",
      "eventKind",
      "reason",
    ]);
  });
});

describe("createEventReport", () => {
  it("pending으로 한 행만 넣고 빈 메모는 NULL로 남긴다", async () => {
    const db = fakeDb();
    const row = await createEventReport(
      db,
      eventReportSchema.parse({
        eventKind: "festival",
        eventId: "  festival-1  ",
        eventTitle: "불꽃축제",
        reason: "wrong_date",
        note: "   ",
      }),
    );
    expect(db.statements).toHaveLength(1);
    expect(row.status).toBe("pending");
    expect(row.eventId).toBe("festival-1");
    expect(row.note).toBeNull();
    expect(db.statements[0]!.args.slice(1, 6)).toEqual([
      "festival",
      "festival-1",
      "불꽃축제",
      "wrong_date",
      null,
    ]);
  });
});
