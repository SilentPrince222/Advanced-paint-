import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { rollbackToCommit, branchExists } from "@/lib/flow-repo";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const branch = new URL(req.url).searchParams.get("branch") ?? undefined;
  try {
    if (branch && !(await branchExists(getDb(), id, branch))) {
      return Response.json({ error: "unknown branch" }, { status: 400 });
    }

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
    const result = await rollbackToCommit(getDb(), id, toCommitId, newCommitId, branch);

    if (result === null) {
      return Response.json({ error: "commit not found" }, { status: 404 });
    }

    return Response.json(result);
  } catch (e) {
    console.error("[POST /api/flows/:id/rollback]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
