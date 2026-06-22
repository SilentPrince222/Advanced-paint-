import Stripe from "stripe";

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("ERROR: STRIPE_SECRET_KEY is not set — see docs/PHASE0.md");
    process.exitCode = 1;
    return;
  }

  const stripe = new Stripe(key);
  const idempotencyKey = `verify_${Date.now()}`;

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: 100,
        currency: "usd",
        payment_method: "pm_card_visa",
        confirm: true,
        off_session: true,
      },
      { idempotencyKey },
    );
    console.log(`SUCCESS — ${intent.id} status=${intent.status}`);
  } catch (err) {
    console.error("FAILURE:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
