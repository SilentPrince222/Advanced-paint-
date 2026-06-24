// scripts/migrate.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const ca = process.env.DATABASE_CA_CERT;
  const dir = join(process.cwd(), "db", "migrations");

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.error(`No migrations directory at ${dir}`);
    process.exitCode = 1;
    return;
  }

  if (files.length === 0) {
    console.log("No migrations to run.");
    return;
  }

  const pool = new Pool({
    connectionString: url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: 1,
  });

  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${file} → ${msg}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

void main();
