import type { Pool, PoolClient } from "pg";
import type {
  GraphDocument,
  GraphNode,
  GraphEdge,
  NodeView,
  NodeType,
} from "@/lib/contract";

/**
 * Pure SQL persistence for the Rung-0 live-copy tables (node/edge/node_view).
 *
 * Design constraints:
 * - TYPE-ONLY imports from "pg" and contract — no "server-only", no db.ts.
 *   This file must remain importable from vitest without a server-only error.
 * - Pool is injected by the caller (route handler passes getDb()).
 * - saveFlow runs in a single transaction: BEGIN → delete (edges→node_view→node)
 *   → insert (nodes→edges→views) → COMMIT; ROLLBACK + rethrow on any error.
 * - params JSONB: always JSON.stringify() + $n::jsonb cast — never a raw object.
 */

export async function saveFlow(
  pool: Pool,
  flowId: string,
  doc: GraphDocument,
): Promise<void> {
  const branchId = `${flowId}-main`;
  const c: PoolClient = await pool.connect();
  try {
    await c.query("BEGIN");

    // Upsert flow + branch (idempotent on repeat saves)
    await c.query(
      `INSERT INTO flow (id, name, default_branch_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET default_branch_id = EXCLUDED.default_branch_id`,
      [flowId, "Demo Flow", branchId],
    );

    await c.query(
      `INSERT INTO branch (id, flow_id, name)
       VALUES ($1, $2, 'main')
       ON CONFLICT (id) DO NOTHING`,
      [branchId, flowId],
    );

    // Delete in FK-safe order: edges → node_view → node
    await c.query(`DELETE FROM edge WHERE branch_id = $1`, [branchId]);
    await c.query(`DELETE FROM node_view WHERE branch_id = $1`, [branchId]);
    await c.query(`DELETE FROM node WHERE branch_id = $1`, [branchId]);

    // Insert nodes first (edges FK → node)
    for (const n of doc.nodes) {
      await c.query(
        `INSERT INTO node (id, branch_id, type, params, credential_ref, is_draft_safe)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [
          n.id,
          branchId,
          n.type,
          JSON.stringify(n.params ?? {}),
          n.credentialRef ?? null,
          n.isDraftSafe,
        ],
      );
    }

    // Insert edges (FK → node)
    for (const e of doc.edges) {
      await c.query(
        `INSERT INTO edge (id, branch_id, from_node_id, to_node_id, condition)
         VALUES ($1, $2, $3, $4, $5)`,
        [e.id, branchId, e.fromNodeId, e.toNodeId, e.condition ?? null],
      );
    }

    // Insert views
    for (const v of doc.views) {
      await c.query(
        `INSERT INTO node_view (branch_id, node_id, x, y, width, height, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [branchId, v.nodeId, v.x, v.y, v.width, v.height, v.color ?? null],
      );
    }

    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/**
 * One run's persisted action row. ids (execId) are minted by the caller (route),
 * written verbatim — matching saveFlow's "client ids are authoritative" idiom.
 */
export interface RunActionRecord {
  execId: string;
  nodeId: string;
  actionType: NodeType;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  status: "success" | "failure";
}

/**
 * Persist one run in a single transaction:
 *   SELECT branch head → INSERT "commit" (snapshot) → UPDATE branch head →
 *   INSERT one exec_log row per fired action.
 *
 * - `"commit"` is quoted in DML because `commit` is a SQL keyword.
 * - jsonb params are always JSON.stringify()'d + $n::jsonb cast (saveFlow idiom).
 * - No id generation here — commitId and each record.execId are passed in.
 */
export async function persistRun(
  pool: Pool,
  flowId: string,
  commitId: string,
  snapshot: GraphDocument,
  records: RunActionRecord[],
): Promise<void> {
  const branchId = `${flowId}-main`;
  const c: PoolClient = await pool.connect();
  try {
    await c.query("BEGIN");

    const b = await c.query(
      `SELECT head_commit_id FROM branch WHERE id = $1`,
      [branchId],
    );
    if (b.rowCount === 0) {
      throw new Error(`branch not found: ${branchId} — save the flow first`);
    }
    const parentId: string | null = b.rows[0].head_commit_id ?? null;

    await c.query(
      `INSERT INTO "commit" (id, flow_id, branch_id, parent_id, author_note, graph_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [commitId, flowId, branchId, parentId, "run", JSON.stringify(snapshot)],
    );

    await c.query(`UPDATE branch SET head_commit_id = $1 WHERE id = $2`, [
      commitId,
      branchId,
    ]);

    for (const r of records) {
      await c.query(
        `INSERT INTO exec_log (id, flow_id, commit_id, node_id, action_type, request, response, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
        [
          r.execId,
          flowId,
          commitId,
          r.nodeId,
          r.actionType,
          JSON.stringify(r.request),
          JSON.stringify(r.response),
          r.status,
        ],
      );
    }

    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function loadFlow(
  pool: Pool,
  flowId: string,
): Promise<GraphDocument | null> {
  // Resolve the branch
  const flowRow = await pool.query(
    `SELECT default_branch_id FROM flow WHERE id = $1`,
    [flowId],
  );
  if (flowRow.rowCount === 0 || !flowRow.rows[0].default_branch_id) {
    return null;
  }
  const branchId: string = flowRow.rows[0].default_branch_id;

  const [nodeRes, edgeRes, viewRes] = await Promise.all([
    pool.query(
      `SELECT id, type, params, credential_ref, is_draft_safe
       FROM node WHERE branch_id = $1 ORDER BY id`,
      [branchId],
    ),
    pool.query(
      `SELECT id, from_node_id, to_node_id, condition
       FROM edge WHERE branch_id = $1 ORDER BY id`,
      [branchId],
    ),
    pool.query(
      `SELECT node_id, x, y, width, height, color
       FROM node_view WHERE branch_id = $1 ORDER BY node_id`,
      [branchId],
    ),
  ]);

  const nodes: GraphNode[] = nodeRes.rows.map((row) => ({
    id: row.id,
    type: row.type as NodeType,
    params: row.params as Record<string, unknown>,
    isDraftSafe: row.is_draft_safe as boolean,
    ...(row.credential_ref ? { credentialRef: row.credential_ref as string } : {}),
  }));

  const edges: GraphEdge[] = edgeRes.rows.map((row) => ({
    id: row.id,
    fromNodeId: row.from_node_id as string,
    toNodeId: row.to_node_id as string,
    ...(row.condition != null ? { condition: row.condition as string } : {}),
  }));

  const views: NodeView[] = viewRes.rows.map((row) => ({
    nodeId: row.node_id as string,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    ...(row.color ? { color: row.color as string } : {}),
  }));

  return { nodes, edges, views };
}
