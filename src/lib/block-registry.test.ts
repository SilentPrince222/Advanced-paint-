import { describe, expect, it } from "vitest";
import {
  BLOCK_REGISTRY,
  CATEGORY_ORDER,
  defaultParamsFor,
  getVariant,
  getVariantsByCategory,
} from "./block-registry";

describe("BLOCK_REGISTRY — SPEC §2.5 canonical demo scope", () => {
  it("defines exactly the 5 demo block types", () => {
    const types = BLOCK_REGISTRY.map((v) => v.type).sort();
    expect(types).toEqual(
      [
        "action.slack.post",
        "action.stripe.charge",
        "condition.if",
        "trigger.schedule",
        "trigger.webhook",
      ].sort(),
    );
  });

  it("has fields defined (possibly empty) for every variant", () => {
    for (const v of BLOCK_REGISTRY) {
      expect(Array.isArray(v.fields)).toBe(true);
    }
  });
});

describe("getVariant", () => {
  it("returns the variant for a known type", () => {
    const v = getVariant("action.stripe.charge");
    expect(v).not.toBeNull();
    expect(v!.label).toBe("Stripe Charge");
    expect(v!.requiresCredential).toBe(true);
  });

  it("returns null for an unknown type", () => {
    expect(getVariant("action.banana.peel")).toBeNull();
    expect(getVariant("")).toBeNull();
  });
});

describe("getVariantsByCategory", () => {
  it("groups variants into all three categories", () => {
    const grouped = getVariantsByCategory();
    expect(Object.keys(grouped).sort()).toEqual(
      ["action", "condition", "trigger"].sort(),
    );
  });

  it("puts the canonical types in their expected buckets", () => {
    const grouped = getVariantsByCategory();
    expect(grouped.trigger.map((v) => v.type).sort()).toEqual(
      ["trigger.schedule", "trigger.webhook"].sort(),
    );
    expect(grouped.action.map((v) => v.type).sort()).toEqual(
      ["action.slack.post", "action.stripe.charge"].sort(),
    );
    expect(grouped.condition.map((v) => v.type)).toEqual(["condition.if"]);
  });

  it("CATEGORY_ORDER lists trigger → action → condition", () => {
    // Palette renders in this canonical order (SPEC §2.5).
    expect(CATEGORY_ORDER).toEqual(["trigger", "action", "condition"]);
  });
});

describe("defaultParamsFor", () => {
  it("seeds every field that has a defaultValue", () => {
    expect(defaultParamsFor("action.stripe.charge")).toEqual({
      amount: 100,
      currency: "usd",
    });
    expect(defaultParamsFor("trigger.schedule")).toEqual({
      cron: "0 9 * * MON",
    });
  });

  it("returns an empty object for a variant with no fields", () => {
    expect(defaultParamsFor("trigger.webhook")).toEqual({});
  });

  it("returns an empty object for an unknown type", () => {
    expect(defaultParamsFor("action.banana.peel")).toEqual({});
  });
});
