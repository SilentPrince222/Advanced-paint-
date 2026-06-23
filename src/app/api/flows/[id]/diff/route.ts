import { getDb } from "@/lib/db";
import { loadCommitSnapshot } from "@/lib/flow-repo";
import { diffGraph } from "@/lib/graph-diff";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return Response.json({ error: "missing from/to" }, { status: 400 });
  }

  try {
    const fromSnap = await loadCommitSnapshot(getDb(), id, from);
    if (!fromSnap) {
      return Response.json({ error: `unknown commit: ${from}` }, { status: 400 });
    }

    const toSnap = await loadCommitSnapshot(getDb(), id, to);
    if (!toSnap) {
      return Response.json({ error: `unknown commit: ${to}` }, { status: 400 });
    }

    return Response.json(diffGraph(fromSnap, toSnap));
  } catch (e) {
    console.error("[GET /api/flows/:id/diff]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
