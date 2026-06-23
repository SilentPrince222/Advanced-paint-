import type { Pool, PoolClient } from "pg";
import type {
  GraphDocument,
  GraphNode,
  GraphEdge,
  NodeView,
  NodeType,
  CommitMeta,
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

/**
 * Maps raw DB rows from node/edge/node_view tables into a GraphDocument.
 * Must Number()-coerce x/y/width/height because pg returns double precision
 * columns as strings. Optional fields are spread only when present.
 */
function rowsToGraphDocument(
  nodeRows: Record<string, unknown>[],
  edgeRows: Record<string, unknown>[],
  viewRows: Record<string, unknown>[],
): GraphDocument {
  const nodes: GraphNode[] = nodeRows.map((row) => ({
    id: row.id as string,
    type: row.type as NodeType,
    params: row.params as Record<string, unknown>,
    isDraftSafe: row.is_draft_safe as boolean,
    ...(row.credential_ref ? { credentialRef: row.credential_ref as string } : {}),
  }));

  const edges: GraphEdge[] = edgeRows.map((row) => ({
    id: row.id as string,
    fromNodeId: row.from_node_id as string,
    toNodeId: row.to_node_id as string,
    ...(row.condition != null ? { condition: row.condition as string } : {}),
  }));

  const views: NodeView[] = viewRows.map((row) => ({
    nodeId: row.node_id as string,
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    ...(row.color ? { color: row.color as string } : {}),
  }));

  return { nodes, edges, views };
}

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

  return rowsToGraphDocument(nodeRes.rows, edgeRes.rows, viewRes.rows);
}

// ── Commit / list / rollback ───────────────────────────────────────────────

export type CommitResult =
  | { ok: true; commit: CommitMeta }
  | { ok: false; reason: "no-branch" | "empty" };

/**
 * Snapshot the current live-copy into a new commit and advance the branch head.
 *
 * Returns {ok:false, reason:"no-branch"} if the branch doesn't exist (save first).
 * Returns {ok:false, reason:"empty"} if the live graph has no nodes (refuse to
 * create a tombstone commit that would wipe the canvas on rollback).
 *
 * Reads live tables SEQUENTIALLY on a single PoolClient — never Promise.all on
 * one PoolClient (parallel queries on the same client violate the protocol).
 */
export async function commitFlow(
  pool: Pool,
  flowId: string,
  commitId: string,
  authorNote: string,
): Promise<CommitResult> {
  const branchId = `${flowId}-main`;
  const c: PoolClient = await pool.connect();
  try {
    await c.query("BEGIN");

    const branchRes = await c.query(
      `SELECT head_commit_id FROM branch WHERE id = $1 FOR UPDATE`,
      [branchId],
    );
    if (branchRes.rowCount === 0) {
      await c.query("ROLLBACK");
      return { ok: false, reason: "no-branch" };
    }
    const parentId: string | null = branchRes.rows[0].head_commit_id ?? null;

    // Read live tables SEQUENTIALLY (single PoolClient — no Promise.all)
    const nodeRes = await c.query(
      `SELECT id, type, params, credential_ref, is_draft_safe
       FROM node WHERE branch_id = $1 ORDER BY id`,
      [branchId],
    );
    const edgeRes = await c.query(
      `SELECT id, from_node_id, to_node_id, condition
       FROM edge WHERE branch_id = $1 ORDER BY id`,
      [branchId],
    );
    const viewRes = await c.query(
      `SELECT node_id, x, y, width, height, color
       FROM node_view WHERE branch_id = $1 ORDER BY node_id`,
      [branchId],
    );

    const snapshot = rowsToGraphDocument(nodeRes.rows, edgeRes.rows, viewRes.rows);

    if (snapshot.nodes.length === 0) {
      await c.query("ROLLBACK");
      return { ok: false, reason: "empty" };
    }

    const insertRes = await c.query(
      `INSERT INTO "commit" (id, flow_id, branch_id, parent_id, author_note, graph_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING created_at`,
      [commitId, flowId, branchId, parentId, authorNote, JSON.stringify(snapshot)],
    );

    await c.query(`UPDATE branch SET head_commit_id = $1 WHERE id = $2`, [
      commitId,
      branchId,
    ]);

    await c.query("COMMIT");

    return {
      ok: true,
      commit: {
        id: commitId,
        parentId,
        authorNote,
        createdAt: new Date(insertRes.rows[0].created_at as string | Date).toISOString(),
      },
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Return commit metadata for a flow, newest first.
 * Ordering: created_at DESC, id DESC — the id tiebreak is sound under the
 * one-commit-per-txn invariant; a future batch-commit path would need a sequence column.
 * Unknown flow → empty array.
 */
export async function listCommits(
  pool: Pool,
  flowId: string,
): Promise<CommitMeta[]> {
  const res = await pool.query(
    `SELECT id, parent_id, author_note, created_at
     FROM "commit"
     WHERE flow_id = $1
     ORDER BY created_at DESC, id DESC`,
    [flowId],
  );
  return res.rows.map((row) => ({
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    authorNote: row.author_note as string,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  }));
}

/**
 * Forward-rollback: restore live tables from toCommitId's snapshot, then
 * INSERT a new forward commit (parent = current head, same snapshot).
 *
 * Returns null if branch or target commit doesn't exist (caller → 404).
 * Reads live tables SEQUENTIALLY on a single PoolClient — no Promise.all.
 */
export async function rollbackToCommit(
  pool: Pool,
  flowId: string,
  toCommitId: string,
  newCommitId: string,
): Promise<{ commit: CommitMeta; doc: GraphDocument } | null> {
  const branchId = `${flowId}-main`;
  const c: PoolClient = await pool.connect();
  try {
    await c.query("BEGIN");

    const branchRes = await c.query(
      `SELECT head_commit_id FROM branch WHERE id = $1 FOR UPDATE`,
      [branchId],
    );
    if (branchRes.rowCount === 0) {
      await c.query("ROLLBACK");
      return null;
    }
    const parentId: string | null = branchRes.rows[0].head_commit_id ?? null;

    // Load target snapshot — flow-scoped to reject cross-flow commit ids
    const commitRes = await c.query(
      `SELECT graph_snapshot FROM "commit" WHERE id = $1 AND flow_id = $2`,
      [toCommitId, flowId],
    );
    if (commitRes.rowCount === 0) {
      await c.query("ROLLBACK");
      return null;
    }
    const snapshot = commitRes.rows[0].graph_snapshot as GraphDocument;

    // Rewrite live tables in FK-safe order: delete edges → views → nodes
    await c.query(`DELETE FROM edge WHERE branch_id = $1`, [branchId]);
    await c.query(`DELETE FROM node_view WHERE branch_id = $1`, [branchId]);
    await c.query(`DELETE FROM node WHERE branch_id = $1`, [branchId]);

    // Insert nodes
    for (const n of snapshot.nodes) {
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

    // Insert edges
    for (const e of snapshot.edges) {
      await c.query(
        `INSERT INTO edge (id, branch_id, from_node_id, to_node_id, condition)
         VALUES ($1, $2, $3, $4, $5)`,
        [e.id, branchId, e.fromNodeId, e.toNodeId, e.condition ?? null],
      );
    }

    // Insert views
    for (const v of snapshot.views) {
      await c.query(
        `INSERT INTO node_view (branch_id, node_id, x, y, width, height, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [branchId, v.nodeId, v.x, v.y, v.width, v.height, v.color ?? null],
      );
    }

    // Forward commit
    const authorNote = `rollback to ${toCommitId.slice(0, 8)}`;
    const insertRes = await c.query(
      `INSERT INTO "commit" (id, flow_id, branch_id, parent_id, author_note, graph_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING created_at`,
      [newCommitId, flowId, branchId, parentId, authorNote, JSON.stringify(snapshot)],
    );

    await c.query(`UPDATE branch SET head_commit_id = $1 WHERE id = $2`, [
      newCommitId,
      branchId,
    ]);

    await c.query("COMMIT");

    return {
      commit: {
        id: newCommitId,
        parentId,
        authorNote,
        createdAt: new Date(insertRes.rows[0].created_at as string | Date).toISOString(),
      },
      doc: snapshot,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
