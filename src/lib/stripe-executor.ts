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

  const amount =
    typeof params.amount === "number" && params.amount > 0
      ? params.amount
      : 100;
  const currency =
    typeof params.currency === "string" && params.currency.length > 0
      ? params.currency
      : "usd";

  try {
    const charge = await stripe.charges.create(
      {
        amount,
        currency,
        source: "tok_visa", // Stripe test token — always succeeds in test mode
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-executor] charge failed:", message);
    return {
      response: { error: message },
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
