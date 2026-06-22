import { getDb } from "@/lib/db";
import { loadFlow, saveFlow } from "@/lib/flow-repo";
import { isNodeType } from "@/lib/contract";
import type { GraphDocument, NodeView } from "@/lib/contract";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const doc = await loadFlow(getDb(), id);
    if (!doc) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(doc);
  } catch (e) {
    console.error("[GET /api/flows/:id]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as GraphDocument;

  // Shape guard — presence + type of top-level arrays
  if (
    !body ||
    !Array.isArray(body.nodes) ||
    !Array.isArray(body.edges) ||
    !Array.isArray(body.views)
  ) {
    return Response.json({ error: "invalid GraphDocument" }, { status: 400 });
  }

  // Δ1: field-level validation
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
  const okViews = body.views.every(
    (v: NodeView) =>
      !!v &&
      typeof v.nodeId === "string" &&
      (["x", "y", "width", "height"] as const).every(
        (k) => typeof v[k] === "number",
      ),
  );

  if (!okNodes || !okEdges || !okViews) {
    return Response.json(
      { error: "invalid GraphDocument fields" },
      { status: 400 },
    );
  }

  try {
    await saveFlow(getDb(), id, body);
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
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
