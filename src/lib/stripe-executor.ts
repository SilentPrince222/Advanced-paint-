import "server-only";
import Stripe from "stripe";
import type { NodeType } from "@/lib/contract";

let _stripe: Stripe | null = null;

function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
}

export interface RealExecutionResult {
  response: Record<string, unknown>;
  status: "success" | "failure";
}

async function executeStripeCharge(
  params: Record<string, unknown>,
  idempotencyKey: string,
): Promise<RealExecutionResult> {
  const stripe = getStripe();
  if (!stripe) {
    console.warn(
      "[stripe-executor] STRIPE_SECRET_KEY not set — falling back to mock",
    );
    return { response: { error: "no_key", mock: true }, status: "failure" };
  }

  if (typeof params.amount !== "number" || !Number.isInteger(params.amount) || params.amount <= 0) {
    return { response: { error: "invalid_amount" }, status: "failure" };
  }
  if (typeof params.currency !== "string" || params.currency.length !== 3) {
    return { response: { error: "invalid_currency" }, status: "failure" };
  }
  const amount = params.amount;
  const currency = params.currency;

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (key.startsWith("sk_live_")) {
    return { response: { error: "live_key_with_test_token" }, status: "failure" };
  }

  try {
    const charge = await stripe.charges.create(
      {
        amount,
        currency,
        source: "tok_visa",
        description: `Aurora flow execution ${idempotencyKey}`,
      },
      { idempotencyKey },
    );

    return {
      response: {
        chargeId: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
      },
      status: "success",
    };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "unknown";
    console.error("[stripe-executor] charge failed:", code);
    return {
      response: { error: "charge_failed", code },
      status: "failure",
    };
  }
}

export async function executeAction(
  type: NodeType,
  params: Record<string, unknown>,
  idempotencyKey: string,
): Promise<RealExecutionResult | null> {
  switch (type) {
    case "action.stripe.charge":
      return executeStripeCharge(params, idempotencyKey);
    default:
      // Non-stripe actions have no real executor yet — return null so caller mocks them
      return null;
  }
}
