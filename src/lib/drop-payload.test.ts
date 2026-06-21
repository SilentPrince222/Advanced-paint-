import { describe, expect, it } from "vitest";
import { parseDropPayload } from "./drop-payload";

describe("parseDropPayload — handleDrop validation (bug #5)", () => {
  it("accepts a well-formed payload", () => {
    expect(parseDropPayload(JSON.stringify({ type: "action.slack.post" }))).toEqual({
      type: "action.slack.post",
    });
  });

  it("rejects malformed JSON", () => {
    expect(parseDropPayload("not json")).toBeNull();
  });

  it("rejects empty / null / undefined input", () => {
    expect(parseDropPayload("")).toBeNull();
    expect(parseDropPayload(null)).toBeNull();
    expect(parseDropPayload(undefined)).toBeNull();
  });

  it("rejects a payload without a `type` field", () => {
    expect(parseDropPayload(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it("rejects an empty-string type", () => {
    expect(parseDropPayload(JSON.stringify({ type: "" }))).toBeNull();
  });

  // This is the crash path: without validation, `{ type: 123 }` would reach
  // addNode() and later blow up the node renderer in categoryOf() with
  // "TypeError: 123.split is not a function".
  it("rejects a non-string type (number)", () => {
    expect(parseDropPayload(JSON.stringify({ type: 123 }))).toBeNull();
  });

  it("rejects a non-string type (object)", () => {
    expect(parseDropPayload(JSON.stringify({ type: { x: 1 } }))).toBeNull();
  });

  it("rejects a non-object JSON value", () => {
    expect(parseDropPayload(JSON.stringify(42))).toBeNull();
    expect(parseDropPayload(JSON.stringify("hello"))).toBeNull();
    expect(parseDropPayload("null")).toBeNull();
  });
});
