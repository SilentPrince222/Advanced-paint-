import { Pool } from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set — see docs/PHASE0.md");
    process.exitCode = 1;
    return;
  }

  const ca = process.env.DATABASE_CA_CERT;
  const pool = new Pool({
    connectionString: url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: 1,
  });

  try {
    const nowResult = await pool.query<{ now: string }>("select now() as now");
    const now = nowResult.rows[0].now;

    const tablesResult = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname='public' order by tablename",
    );
    const tables = tablesResult.rows.map((r) => r.tablename);

    console.log(`OK — connected at ${now}`);
    if (tables.length === 0) {
      console.log("Tables: (none — run npm run db:init)");
    } else {
      console.log(`Tables: ${tables.join(", ")}`);
    }
  } catch (err) {
    console.error("FAILURE:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
