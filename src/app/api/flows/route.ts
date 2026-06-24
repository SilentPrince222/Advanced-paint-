// src/app/api/flows/route.ts
import { getDb } from "@/lib/db";
import { bootstrapFlow } from "@/lib/flow-repo";

export async function GET() {
  try {
    const pool = getDb();
    const res = await pool.query(
      `SELECT
         f.id,
         f.name,
         f.updated_at,
         (SELECT count(*)::int FROM node WHERE branch_id = f.default_branch_id) AS node_count
       FROM flow f
       ORDER BY f.updated_at DESC, f.id DESC`,
    );
    const flows = res.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      updatedAt: new Date(r.updated_at as string | Date).toISOString(),
      nodeCount: (r.node_count as number) ?? 0,
    }));
    return Response.json(flows);
  } catch (e) {
    console.error("[GET /api/flows]", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 100) {
    return Response.json(
      { error: "name is required (1-100 chars after trim)" },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();

  try {
    const pool = getDb();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await bootstrapFlow(client, id, name);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return Response.json(
      { id, name, updatedAt: new Date().toISOString(), nodeCount: 0 },
      { status: 201 },
    );
  } catch (e) {
    console.error("[POST /api/flows]", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
