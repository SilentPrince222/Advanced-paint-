import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { createBranch, listBranches } from "@/lib/flow-repo";
import { parseJsonObject } from "@/lib/parse-json-body";

/**
 * GET /api/flows/:id/branches → Branch[] (run 3b-2). Ordered by name; the first
 * row is the default `main` branch. Read-only — mirrors the POST below + the
 * diff/route.ts GET precedent.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const branches = await listBranches(getDb(), id);
    return Response.json(branches);
  } catch (e) {
    console.error("[GET /api/flows/:id/branches]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}

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
    const parsed = await parseJsonObject(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

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
