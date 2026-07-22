import { describe, expect, it } from "vitest";
import { timingSafeStringEqual } from "../src/security.js";

describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEqual("secret-token", "secret-token")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeStringEqual("secret-token", "secret-tokeN")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeStringEqual("short", "much-longer-value")).toBe(false);
  });

  it("returns false when one string is empty", () => {
    expect(timingSafeStringEqual("", "non-empty")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeStringEqual("", "")).toBe(true);
  });
});
