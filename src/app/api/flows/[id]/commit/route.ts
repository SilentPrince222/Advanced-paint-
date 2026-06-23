import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { commitFlow, branchExists } from "@/lib/flow-repo";

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

    let authorNote = "";
    if ("authorNote" in body) {
      if (typeof body.authorNote !== "string") {
        return Response.json({ error: "authorNote must be a string" }, { status: 400 });
      }
      if (body.authorNote.length > 280) {
        return Response.json({ error: "authorNote must be ≤ 280 characters" }, { status: 400 });
      }
      authorNote = body.authorNote;
    }

    const commitId = randomUUID();
    const r = await commitFlow(getDb(), id, commitId, authorNote, branch);

    if (!r.ok && r.reason === "no-branch") {
      return Response.json({ error: "not found — save first" }, { status: 404 });
    }
    if (!r.ok && r.reason === "empty") {
      return Response.json({ error: "cannot commit an empty graph" }, { status: 400 });
    }
    if (!r.ok) {
      return Response.json({ error: "internal server error" }, { status: 500 });
    }

    return Response.json(r.commit);
  } catch (e) {
    console.error("[POST /api/flows/:id/commit]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
