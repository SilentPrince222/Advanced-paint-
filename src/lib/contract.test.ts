import { describe, it, expect } from "vitest";
import { paramSchemas } from "./contract";

describe("paramSchemas — B22 contract/executor disagreement", () => {
  it("B22 — contract admits amount 0 and empty currency (API-valid, executor rewrites them)", () => {
    const parsed = paramSchemas["action.stripe.charge"].safeParse({
      amount: 0,
      currency: "",
    });
    expect(parsed.success).toBe(true);
  });
});
