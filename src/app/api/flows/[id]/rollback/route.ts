import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { rollbackToCommit, branchExists } from "@/lib/flow-repo";
import { parseBranchParam } from "@/lib/branch-query";
import { parseJsonObject } from "@/lib/parse-json-body";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const branchParsed = parseBranchParam(req.url);
  if (!branchParsed.ok) return branchParsed.response;
  const branch = branchParsed.branch;
  try {
    if (branch && !(await branchExists(getDb(), id, branch))) {
      return Response.json({ error: "unknown branch" }, { status: 400 });
    }

    const parsed = await parseJsonObject(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

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
    console.error("[POST /api/flows/:id/rollback]", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
