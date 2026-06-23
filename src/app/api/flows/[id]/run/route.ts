import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { loadFlow, persistRun, type RunActionRecord } from "@/lib/flow-repo";
import { runGraph, mockResponse } from "@/lib/interpreter";
import type { ExecLogEntry } from "@/lib/contract";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const doc = await loadFlow(getDb(), id);
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

    const commitId = randomUUID();
    const now = new Date().toISOString();
    const records: RunActionRecord[] = [];
    const entries: ExecLogEntry[] = [];

    for (const s of actions) {
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

    await persistRun(getDb(), id, commitId, doc, records);
    return Response.json({ commitId, entries });
  } catch (e) {
    console.error("[POST /api/flows/:id/run]", e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
