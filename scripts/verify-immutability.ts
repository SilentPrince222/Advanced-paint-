import { Pool } from "pg";

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  try {
    // Part (a): metadata assertions (read-only)
    console.log("==> Part (a): Metadata assertions");

    // Check app_role privileges on exec_log (expect INSERT/SELECT only)
    const privRes = await pool.query(`
      SELECT
        has_table_privilege('app_role', 'exec_log', 'INSERT') AS can_insert,
        has_table_privilege('app_role', 'exec_log', 'SELECT') AS can_select,
        has_table_privilege('app_role', 'exec_log', 'UPDATE') AS can_update,
        has_table_privilege('app_role', 'exec_log', 'DELETE') AS can_delete,
        has_table_privilege('app_role', 'exec_log', 'TRUNCATE') AS can_truncate
    `);
    const priv = privRes.rows[0];
    if (
      !priv.can_insert ||
      !priv.can_select ||
      priv.can_update ||
      priv.can_delete ||
      priv.can_truncate
    ) {
      console.error(
        "ASSERTION FAILED: app_role exec_log privileges incorrect",
        priv,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      "✓ app_role has INSERT/SELECT only on exec_log (no UPDATE/DELETE/TRUNCATE)",
    );

    // Check trigger existence and enabled status
    const triggerRes = await pool.query(`
      SELECT t.tgname, t.tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'exec_log'
        AND t.tgname IN ('exec_log_no_update', 'exec_log_no_truncate')
    `);
    const triggers = triggerRes.rows;
    if (triggers.length !== 2) {
      console.error(
        `ASSERTION FAILED: expected 2 triggers, found ${triggers.length}`,
        triggers,
      );
      process.exitCode = 1;
      return;
    }
    for (const row of triggers) {
      if (row.tgenabled !== "O") {
        console.error(
          `ASSERTION FAILED: trigger ${row.tgname} not enabled (tgenabled=${row.tgenabled})`,
        );
        process.exitCode = 1;
        return;
      }
    }
    console.log(
      "✓ triggers exec_log_no_update and exec_log_no_truncate exist and enabled",
    );

    // Part (b): live rejection test (SAVEPOINT)
    console.log("==> Part (b): Live rejection test");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SAVEPOINT s");

      let rejected = false;
      let errText: string | null = null;

      try {
        await client.query("TRUNCATE exec_log");
      } catch (e) {
        rejected = true;
        errText = e instanceof Error ? e.message : String(e);
      }

      await client.query("ROLLBACK TO s");
      await client.query("COMMIT");

      if (!rejected) {
        console.error("ASSERTION FAILED: TRUNCATE exec_log was not rejected");
        process.exitCode = 1;
        return;
      }

      console.log("✓ TRUNCATE exec_log rejected (trigger-enforced append-only)");
      console.log(`  Rejection message: ${errText}`);
    } finally {
      client.release();
    }

    console.log("==> All immutability checks passed");
  } catch (err) {
    console.error("FAILURE:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
