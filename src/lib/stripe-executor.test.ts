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

  it("B22 — amount 0 must fail closed without calling Stripe", async () => {
    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { amount: 0, currency: "usd" },
      "exec-zero",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("invalid_amount");
    expect(chargesCreate).not.toHaveBeenCalled();
  });

  it("B22 — empty currency must fail closed without calling Stripe", async () => {
    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { amount: 500, currency: "" },
      "exec-empty-currency",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("invalid_currency");
    expect(chargesCreate).not.toHaveBeenCalled();
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

describe("stripe-executor — 2026-06-24 audit regressions", () => {
  beforeEach(async () => {
    vi.resetModules();
    chargesCreate.mockClear();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });

  it("C2 — missing amount must fail closed, not silently charge $1.00", async () => {
    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { currency: "usd" },
      "exec-missing-amount",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("invalid_amount");
    expect(chargesCreate).not.toHaveBeenCalled();
  });

  it("C2 — null amount must fail closed, not silently charge $1.00", async () => {
    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { amount: null, currency: "usd" },
      "exec-null-amount",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("invalid_amount");
    expect(chargesCreate).not.toHaveBeenCalled();
  });

  it("C2 — non-numeric amount must fail closed, not silently charge $1.00", async () => {
    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { amount: "100", currency: "usd" },
      "exec-string-amount",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("invalid_amount");
    expect(chargesCreate).not.toHaveBeenCalled();
  });

  it("m8 — live Stripe key must not use tok_visa test token", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_fake_key_for_test";
    const { executeAction } = await import("./stripe-executor");
    const result = await executeAction(
      "action.stripe.charge",
      { amount: 100, currency: "usd" },
      "exec-live-guard",
    );

    expect(result?.status).toBe("failure");
    expect(result?.response.error).toBe("live_key_with_test_token");
    expect(chargesCreate).not.toHaveBeenCalled();
  });

  it("m5 — Stripe charge failure logs error code only, not full message with key fragment", async () => {
    const err = Object.assign(
      new Error("Invalid API Key provided: sk_test_abcd****wxyz"),
      { code: "invalid_api_key" },
    );
    chargesCreate.mockRejectedValueOnce(err);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { executeAction } = await import("./stripe-executor");
    await executeAction(
      "action.stripe.charge",
      { amount: 100, currency: "usd" },
      "exec-log-redact",
    );

    expect(logSpy).toHaveBeenCalledWith(
      "[stripe-executor] charge failed:",
      "invalid_api_key",
    );
    expect(String(logSpy.mock.calls[0]?.[1] ?? "")).not.toContain("sk_test");

    logSpy.mockRestore();
  });
});
