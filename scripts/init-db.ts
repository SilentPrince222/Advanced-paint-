import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { splitSqlStatements } from "../src/lib/sql-splitter";

/**
 * Initialize the Aurora PostgreSQL schema (SPEC §3) via the `pg` driver.
 *
 * Replaces the `psql -f db/schema.sql` one-liner so the project has no system
 * dependency on the psql CLI — everything runs through the already-installed
 * `pg` package and picks up `.env` via `tsx --env-file=.env`.
 *
 * Statements execute one-by-one (matching psql's default autocommit behavior)
 * so a failure on the Aurora-specific `grant rds_iam to app_role` (line 84)
 * does NOT roll back the tables created before it.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set — see docs/PHASE0.md");
    process.exitCode = 1;
    return;
  }

  const ca = process.env.DATABASE_CA_CERT;
  const schemaPath = join(process.cwd(), "db", "schema.sql");
  const raw = readFileSync(schemaPath, "utf8");

  const statements = splitSqlStatements(raw);

  const pool = new Pool({
    connectionString: url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: 1,
  });

  let ok = 0;
  let failed = 0;
  try {
    for (const stmt of statements) {
      const head = stmt.split("\n")[0].trim().slice(0, 70);
      try {
        await pool.query(stmt);
        console.log(`  ✓ ${head}`);
        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${head}  →  ${msg}`);
        failed++;
      }
    }
    console.log(`\nDone: ${ok} succeeded, ${failed} failed.`);
    if (failed > 0) {
      console.log(
        "Non-Aurora? Comment out 'grant rds_iam to app_role;' in db/schema.sql — see PHASE0.md:40.",
      );
    }
  } finally {
    await pool.end();
  }
}

void main();
