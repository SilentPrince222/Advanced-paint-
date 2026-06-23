import type { ExecLogEntry, GraphDocument } from "@/lib/contract";

export const DEMO_FLOW_ID = "demo";

/**
 * Fetch the current graph from the server.
 * Returns null if the flow doesn't exist yet (404).
 * Throws on any other non-OK response.
 */
export async function fetchFlow(id: string): Promise<GraphDocument | null> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchFlow failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<GraphDocument>;
}

/**
 * Persist the given graph to the server.
 * Throws on any non-OK response.
 */
export async function saveFlowToServer(
  id: string,
  doc: GraphDocument,
): Promise<void> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`saveFlowToServer failed: ${res.status} ${text}`);
  }
}

export interface RunResult {
  commitId: string | null;
  entries: ExecLogEntry[];
}

/**
 * Run the saved flow on the server (interpreter → mock actions → exec_log).
 * Throws on any non-OK response.
 */
export async function runFlow(id: string): Promise<RunResult> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`runFlow failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<RunResult>;
}
