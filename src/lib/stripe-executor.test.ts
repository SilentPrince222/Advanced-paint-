import { describe, it, expect, vi, beforeEach } from "vitest";

const chargesCreate = vi.fn().mockResolvedValue({
  id: "ch_test",
  amount: 100,
  currency: "usd",
  status: "succeeded",
});

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function StripeMock() {
    return { charges: { create: chargesCreate } };
  }),
}));

describe("stripe-executor — B22 money-correctness", () => {
  beforeEach(async () => {
    vi.resetModules();
    chargesCreate.mockClear();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });

  it("B22 — amount 0 must not be silently rewritten to 100", async () => {
    const { executeAction } = await import("./stripe-executor");
    await executeAction(
      "action.stripe.charge",
      { amount: 0, currency: "usd" },
      "exec-zero",
    );

    expect(chargesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 0, currency: "usd" }),
      expect.objectContaining({ idempotencyKey: "exec-zero" }),
    );
  });

  it("B22 — empty currency must not be silently rewritten to usd", async () => {
    const { executeAction } = await import("./stripe-executor");
    await executeAction(
      "action.stripe.charge",
      { amount: 500, currency: "" },
      "exec-empty-currency",
    );

    expect(chargesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, currency: "" }),
      expect.objectContaining({ idempotencyKey: "exec-empty-currency" }),
    );
  });

  it("B29 — Stripe error message must not leak into response.error", async () => {
    chargesCreate.mockRejectedValueOnce(
      new Error("Invalid API Key provided: sk_test_abcd****"),
    );

    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { amount: 100, currency: "usd" },
      "exec-leak",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("charge_failed");
    expect(String(result?.response.error)).not.toContain("sk_test");
  });
});
