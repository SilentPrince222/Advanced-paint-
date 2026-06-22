# Phase 0 — Infra Provisioning Runbook (Sync 0)

Sync 0 is done when all 3 verifies pass + contract.ts merged to main.

---

## 1. Aurora PostgreSQL

### Provision

1. Create an Aurora Serverless v2 cluster (PostgreSQL-compatible, password auth for Phase 0).
2. Note the cluster endpoint, database name (`postgres`), master user, and password.
3. Set `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=verify-full
   ```

### TLS — recommended

Set `DATABASE_CA_CERT` to the PEM contents of the [AWS RDS global CA bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html). Download the bundle and paste its contents (or `cat rds-ca-2019-root.pem`) into the env var:

```
DATABASE_CA_CERT="-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----"
```

With `DATABASE_CA_CERT` set, `db.ts` passes `{ ca, rejectUnauthorized: true }` to `pg.Pool` — the server certificate is fully verified. We never hardcode `rejectUnauthorized: false`.

`sslmode=require` (without `DATABASE_CA_CERT`) is only a quick encrypted-but-UNVERIFIED spike — the connection is encrypted but the server identity is not verified. Acceptable for initial local testing; not acceptable for production.

### Initialize schema

```bash
npm run db:init
```

This runs `psql "$DATABASE_URL" -f db/schema.sql` as the DB owner/superuser.

> **Note:** `grant rds_iam to app_role;` in `db/schema.sql` resolves only on Aurora (the `rds_iam` role is Aurora-specific). If running against a plain local PostgreSQL instance, comment out that line before running `db:init`.

> Run `db:init` as the DB owner or a superuser. The `app_role` role itself connects with lower privileges — that is what the immutability demo uses.

### Verify

```bash
npm run verify:db
```

---

## 2. Stripe

1. Create a [Stripe test account](https://dashboard.stripe.com/register) and obtain a test secret key (`sk_test_…`).
2. Set in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_…
   ```
3. Verify:
   ```bash
   npm run verify:stripe
   ```
   The script creates a test PaymentIntent with an Idempotency-Key (demonstrating SPEC §6.2 write-integrity). Expect `SUCCESS — pi_… status=requires_capture` or similar.

---

## 3. Vercel

No `vercel.ts` is committed — Vercel auto-detects Next.js; a `vercel.ts` is only needed for custom routes or cron config.

```bash
vercel login
vercel link
vercel env add DATABASE_URL
vercel env add DATABASE_CA_CERT
vercel env add STRIPE_SECRET_KEY
vercel --prod
```

---

## Done

Sync 0 is complete when:
- `npm run verify:db` exits 0
- `npm run verify:stripe` exits 0
- `contract.ts` is merged to main
