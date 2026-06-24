import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeDate } from "./format-date";

describe("formatRelativeDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Today at HH:MM' for same-day dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2026-06-23T10:30:00Z");
    expect(result).toMatch(/^Today at /);
  });

  it("returns 'Yesterday' for previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2026-06-22T10:30:00Z");
    expect(result).toBe("Yesterday");
  });

  it("returns 'Mon DD' for same-year dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2026-03-15T10:30:00Z");
    expect(result).toMatch(/Mar 15/);
  });

  it("returns 'Mon DD, YYYY' for different-year dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2025-12-01T10:30:00Z");
    expect(result).toMatch(/Dec 1.*2025/);
  });

  it("B42 — server-ahead timestamps near midnight still show 'Today at …'", () => {
    vi.useFakeTimers();
    // Client: late evening. Server updatedAt: just after midnight (clock skew).
    vi.setSystemTime(new Date(2026, 5, 23, 23, 30, 0));
    const result = formatRelativeDate(
      new Date(2026, 5, 24, 0, 0, 2).toISOString(),
    );
    expect(result).toMatch(/^Today at /);
  });

  it("B43 — malformed ISO strings must not render 'Invalid Date'", () => {
    expect(formatRelativeDate("")).not.toMatch(/Invalid Date/);
    expect(formatRelativeDate("not-a-date")).not.toMatch(/Invalid Date/);
  });
});
