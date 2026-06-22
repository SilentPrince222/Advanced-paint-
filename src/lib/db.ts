import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;

/**
 * Process-wide pg Pool, created lazily on first use (never at import) so `next build`
 * — which compiles route handlers but never runs them — can't throw when DATABASE_URL
 * is unset. Reused across Fluid Compute invocations.
 *
 * Phase 0: password auth via DATABASE_URL. TLS is VERIFIED when DATABASE_CA_CERT
 * (the AWS RDS CA bundle, PEM contents) is provided; otherwise the URL's sslmode
 * governs. We never hardcode-disable certificate verification.
 * Do NOT call getDb() at module level — only inside a request handler.
 * Fluid Compute (Day 1): wrap `pool` with attachDatabasePool() from "@vercel/functions".
 */
export function getDb(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — provision Aurora and set it in .env (see docs/PHASE0.md).",
      );
    }
    const ca = process.env.DATABASE_CA_CERT;
    pool = new Pool({
      connectionString: url,
      ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
      max: 5,
    });
  }
  return pool;
}
