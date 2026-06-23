import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { loadFlow, persistRun, branchExists, type RunActionRecord } from "@/lib/flow-repo";
import { runGraph, mockResponse } from "@/lib/interpreter";
import { executeAction } from "@/lib/stripe-executor";
import type { ExecLogEntry } from "@/lib/contract";
import { parseBranchParam } from "@/lib/branch-query";

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
      const execId = randomUUID();
      let response: Record<string, unknown>;
      let status: "success" | "failure" = "success";

      if (mockMode) {
        response = mockResponse(s.type, execId);
      } else {
        // Real execution path — currently supports stripe; others fall back to mock
        const result = await executeAction(s.type, s.request, execId);
        if (result) {
          response = result.response;
          status = result.status;
        } else {
          // No real executor for this action type — mock it
          response = mockResponse(s.type, execId);
        }
      }

      records.push({
        execId,
        nodeId: s.nodeId,
        actionType: s.type,
        request: s.request,
        response,
        status,
      });
      entries.push({
        id: execId,
        flowId: id,
        commitId,
        nodeId: s.nodeId,
        actionType: s.type,
        request: s.request,
        response,
        status,
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
