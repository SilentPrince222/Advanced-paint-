import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { loadFlow, persistRun, branchExists, type RunActionRecord } from "@/lib/flow-repo";
import { runGraph, mockResponse } from "@/lib/interpreter";
import type { ExecLogEntry } from "@/lib/contract";

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

    const doc = await loadFlow(getDb(), id, branch);
    if (!doc) {
      return Response.json(
        { error: "not found — save first" },
        { status: 404 },
      );
    }

    const { steps } = runGraph(doc);
    const actions = steps.filter((s) => s.kind === "action");

    // No actions to execute → no commit, no exec_log row (risk-m5).
    if (actions.length === 0) {
      return Response.json({ commitId: null, entries: [] });
    }

    const mockMode =
      process.env.MOCK_MODE === "1" || process.env.MOCK_MODE === "true";

    const commitId = randomUUID();
    const now = new Date().toISOString();
    const records: RunActionRecord[] = [];
    const entries: ExecLogEntry[] = [];

    for (const s of actions) {
      if (!mockMode) {
        return Response.json(
          { error: "Lambda not wired — set MOCK_MODE=1 for demo" },
          { status: 501 },
        );
      }

      const execId = randomUUID();
      const response = mockResponse(s.type, execId);
      records.push({
        execId,
        nodeId: s.nodeId,
        actionType: s.type,
        request: s.request,
        response,
        status: "success",
      });
      entries.push({
        id: execId,
        flowId: id,
        commitId,
        nodeId: s.nodeId,
        actionType: s.type,
        request: s.request,
        response,
        status: "success",
        createdAt: now,
      });
    }

    await persistRun(getDb(), id, commitId, doc, records, branch);
    return Response.json({ commitId, entries });
  } catch (e) {
    console.error("[POST /api/flows/:id/run]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
