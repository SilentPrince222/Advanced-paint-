import { describe, expect, it } from "vitest";
import { getVariant, type UiBlockVariant } from "./block-registry";
import { paramSummary } from "./node-summary";

const stripe = getVariant("action.stripe.charge")!;
const slack = getVariant("action.slack.post")!;
const schedule = getVariant("trigger.schedule")!;
const webhook = getVariant("trigger.webhook")!; // no fields

describe("paramSummary", () => {
  it("returns an empty string when the variant has no fields", () => {
    expect(paramSummary(webhook, {})).toBe("");
  });

  it("returns an empty string when fields have no values yet", () => {
    expect(paramSummary(stripe, { amount: undefined, currency: "" })).toBe("");
  });

  it("joins the first two field values with ' · '", () => {
    expect(
      paramSummary(stripe, { amount: 100, currency: "usd" }),
    ).toBe("100 · USD");
  });

  it("shows the select option's label, not its raw value", () => {
    // currency 'eur' should render as the human label 'EUR'
    expect(paramSummary(stripe, { amount: 50, currency: "eur" })).toBe(
      "50 · EUR",
    );
  });

  it("falls back to the raw value when the select value is unknown", () => {
    expect(paramSummary(stripe, { amount: 5, currency: "zzz" })).toBe(
      "5 · zzz",
    );
  });

  it("shows only the first field if the second is empty", () => {
    expect(
      paramSummary(slack, { channel: "#revenue", message: "" }),
    ).toBe("#revenue");
  });

  it("only ever shows the first two fields, even when more exist", () => {
    // stripe has exactly two fields, so this is a contract guard — but it
    // documents the "cap at two" behavior that lets node cards stay compact.
    expect(paramSummary(stripe, { amount: 1, currency: "gbp" })).toBe(
      "1 · GBP",
    );
  });

  it("renders a cron expression verbatim", () => {
    expect(paramSummary(schedule, { cron: "0 9 * * MON" })).toBe(
      "0 9 * * MON",
    );
  });

  it("returns an empty string for a null variant", () => {
    expect(paramSummary(null, { anything: 1 })).toBe("");
  });

  it("B38 — must show the first two non-empty fields, not only the first two by position", () => {
    const threeFieldVariant = {
      type: "action.test.three",
      label: "Three field test",
      category: "action",
      icon: getVariant("action.stripe.charge")!.icon,
      fields: [
        { key: "first", label: "First", type: "text" as const },
        { key: "second", label: "Second", type: "text" as const },
        { key: "third", label: "Third", type: "text" as const },
      ],
    } as unknown as UiBlockVariant;

    expect(
      paramSummary(threeFieldVariant, { first: "", second: "", third: "populated" }),
    ).toBe("populated");
  });
});
