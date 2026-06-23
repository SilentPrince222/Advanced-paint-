import { getDb } from "@/lib/db";
import { loadFlow, saveFlow, branchExists } from "@/lib/flow-repo";
import { isNodeType, paramSchemas } from "@/lib/contract";
import type { GraphDocument, NodeView } from "@/lib/contract";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const branch = new URL(req.url).searchParams.get("branch") ?? undefined;
  try {
    if (branch && !(await branchExists(getDb(), id, branch))) {
      return Response.json({ error: "unknown branch" }, { status: 400 });
    }
    const doc = await loadFlow(getDb(), id, branch);
    if (!doc) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(doc);
  } catch (e) {
    // Log the real error server-side; never leak pg/internal detail to the client (B07).
    console.error("[GET /api/flows/:id]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const branch = new URL(req.url).searchParams.get("branch") ?? undefined;

  // Malformed JSON is a client error, not a 500 (B06).
  let body: GraphDocument;
  try {
    body = (await req.json()) as GraphDocument;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Shape guard — presence + type of top-level arrays
  if (
    !body ||
    !Array.isArray(body.nodes) ||
    !Array.isArray(body.edges) ||
    !Array.isArray(body.views)
  ) {
    return Response.json({ error: "invalid GraphDocument" }, { status: 400 });
  }

  // Field-level validation
  const okNodes = body.nodes.every(
    (n) =>
      !!n &&
      typeof n.id === "string" &&
      isNodeType(n.type) &&
      typeof n.isDraftSafe === "boolean" &&
      typeof n.params === "object" &&
      n.params !== null,
  );
  const okEdges = body.edges.every(
    (e) =>
      !!e &&
      typeof e.id === "string" &&
      typeof e.fromNodeId === "string" &&
      typeof e.toNodeId === "string",
  );
  // Number.isFinite rejects NaN / ±Infinity / non-numbers (B03) — a non-finite
  // coordinate stored in `double precision` corrupts the canvas on round-trip.
  const okViews = body.views.every(
    (v: NodeView) =>
      !!v &&
      typeof v.nodeId === "string" &&
      (["x", "y", "width", "height"] as const).every((k) =>
        Number.isFinite(v[k]),
      ),
  );

  if (!okNodes || !okEdges || !okViews) {
    return Response.json(
      { error: "invalid GraphDocument fields" },
      { status: 400 },
    );
  }

  // Per-type param allowlist — the §2.5 zod schema, enforced at the API
  // boundary so junk/typed-wrong params never reach JSONB or exec_log (B01/B02).
  const badNode = body.nodes.find(
    (n) => !paramSchemas[n.type].safeParse(n.params).success,
  );
  if (badNode) {
    return Response.json(
      { error: `invalid params for node ${badNode.id} (${badNode.type})` },
      { status: 400 },
    );
  }

  // Uniqueness — duplicate ids would violate the DB primary keys and abort the
  // transaction with a leaked pg error (B05); reject cleanly up front.
  const nodeIds = new Set<string>();
  for (const n of body.nodes) {
    if (nodeIds.has(n.id)) {
      return Response.json(
        { error: `duplicate node id: ${n.id}` },
        { status: 400 },
      );
    }
    nodeIds.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of body.edges) {
    if (edgeIds.has(e.id)) {
      return Response.json(
        { error: `duplicate edge id: ${e.id}` },
        { status: 400 },
      );
    }
    edgeIds.add(e.id);
  }
  const seenViews = new Set<string>();
  for (const v of body.views) {
    if (seenViews.has(v.nodeId)) {
      return Response.json(
        { error: `duplicate view for node: ${v.nodeId}` },
        { status: 400 },
      );
    }
    seenViews.add(v.nodeId);
  }

  // Referential integrity — edges & views must reference declared nodes (B04).
  // Without this the DB FK throws a 500 with constraint/table names; orphan
  // views (no FK) would persist silently.
  for (const e of body.edges) {
    if (!nodeIds.has(e.fromNodeId) || !nodeIds.has(e.toNodeId)) {
      return Response.json(
        { error: `edge ${e.id} references an unknown node` },
        { status: 400 },
      );
    }
  }
  for (const v of body.views) {
    if (!nodeIds.has(v.nodeId)) {
      return Response.json(
        { error: `view references an unknown node: ${v.nodeId}` },
        { status: 400 },
      );
    }
  }

  try {
    if (branch && !(await branchExists(getDb(), id, branch))) {
      return Response.json({ error: "unknown branch" }, { status: 400 });
    }
    await saveFlow(getDb(), id, body, branch);
    return Response.json({
      ok: true,
      flowId: id,
      counts: {
        nodes: body.nodes.length,
        edges: body.edges.length,
        views: body.views.length,
      },
    });
  } catch (e) {
    console.error("[PUT /api/flows/:id]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
