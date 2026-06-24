import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./sql-splitter";

describe("splitSqlStatements — B37", () => {
  it("B37 — `--` inside a single-quoted literal must not truncate the statement", () => {
    const sql = `INSERT INTO flow (id, name) VALUES ('test', 'demo--flow');`;
    const stmts = splitSqlStatements(sql);

    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toBe(
      "INSERT INTO flow (id, name) VALUES ('test', 'demo--flow')",
    );
  });

  it("preserves semicolons inside dollar-quoted bodies", () => {
    const sql = `CREATE FUNCTION f() RETURNS trigger AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
    const stmts = splitSqlStatements(sql);

    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain("RETURN NEW;");
  });
});
