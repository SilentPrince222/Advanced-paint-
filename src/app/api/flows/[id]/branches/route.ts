import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { createBranch } from "@/lib/flow-repo";

/**
 * POST /api/flows/:id/branches  {name, fromCommitId} → Branch (SPEC §2.4).
 * Forks a new branch from an existing commit of this flow. The branch id is
 * minted server-side (randomUUID, route-owned — matches commit/rollback idiom).
 * Unknown fromCommitId (for this flow) → 400, not a 500.
 */
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

    if (!body.name || typeof body.name !== "string") {
      return Response.json({ error: "missing name" }, { status: 400 });
    }
    if (!body.fromCommitId || typeof body.fromCommitId !== "string") {
      return Response.json({ error: "missing fromCommitId" }, { status: 400 });
    }

    const newBranchId = randomUUID();
    const branch = await createBranch(
      getDb(),
      id,
      body.name,
      body.fromCommitId,
      newBranchId,
    );

    if (branch === null) {
      return Response.json(
        { error: `unknown fromCommitId: ${body.fromCommitId}` },
        { status: 400 },
      );
    }

    return Response.json(branch);
  } catch (e) {
    console.error("[POST /api/flows/:id/branches]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
