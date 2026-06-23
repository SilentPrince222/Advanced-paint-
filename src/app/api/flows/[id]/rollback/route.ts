import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { rollbackToCommit } from "@/lib/flow-repo";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    if (!body.toCommitId || typeof body.toCommitId !== "string") {
      return Response.json({ error: "missing toCommitId" }, { status: 400 });
    }
    const toCommitId = body.toCommitId;

    const newCommitId = randomUUID();
    const result = await rollbackToCommit(getDb(), id, toCommitId, newCommitId);

    if (result === null) {
      return Response.json({ error: "commit not found" }, { status: 404 });
    }

    return Response.json(result);
  } catch (e) {
    console.error("[POST /api/flows/:id/rollback]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
