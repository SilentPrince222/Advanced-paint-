import { describe, expect, it } from "vitest";
import { categoryOf } from "./types";

/**
 * `categoryOf` derives a block's category from the canonical `type` prefix
 * (SPEC §2.1). It underpins palette grouping, node styling (CATEGORY_STYLES),
 * and the SidePanel's per-category affordances — so the fallback rule matters.
 */
describe("categoryOf", () => {
  it("returns the prefix segment for each canonical category", () => {
    expect(categoryOf("trigger.webhook")).toBe("trigger");
    expect(categoryOf("trigger.schedule")).toBe("trigger");
    expect(categoryOf("action.stripe.charge")).toBe("action");
    expect(categoryOf("action.slack.post")).toBe("action");
    expect(categoryOf("condition.if")).toBe("condition");
  });

  it("falls back to 'action' for an unknown prefix (safe default)", () => {
    // Defensive: a backend- or user-supplied type we don't know yet shouldn't
    // break the canvas. 'action' is the most permissive default.
    expect(categoryOf("future.banana.peel")).toBe("action");
    expect(categoryOf("noseparator")).toBe("action");
    expect(categoryOf("")).toBe("action");
  });

  it("uses only the segment before the first dot", () => {
    // A type like "action.stripe.charge" must NOT confuse the second segment
    // for a category. Only the head counts.
    expect(categoryOf("trigger")).toBe("trigger");
    expect(categoryOf("action")).toBe("action");
    expect(categoryOf("condition")).toBe("condition");
  });
});
