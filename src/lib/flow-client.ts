import type { CommitMeta, ExecLogEntry, GraphDocument, GraphDiff } from "@/lib/contract";

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

/**
 * Create an explicit commit of the current live-copy.
 * Throws on any non-OK response (400 empty graph, 404 save-first, 500).
 */
export async function commitFlow(
  id: string,
  authorNote: string,
): Promise<CommitMeta> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authorNote }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`commitFlow failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<CommitMeta>;
}

/**
 * List commits for a flow, newest first.
 * Throws on any non-OK response.
 */
export async function listCommits(id: string): Promise<CommitMeta[]> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}/commits`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`listCommits failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<CommitMeta[]>;
}

/**
 * Forward-rollback to a prior commit.
 * Returns the new forward commit and the restored graph document.
 * Throws on any non-OK response.
 */
export async function rollbackFlow(
  id: string,
  toCommitId: string,
): Promise<{ commit: CommitMeta; doc: GraphDocument }> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toCommitId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`rollbackFlow failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ commit: CommitMeta; doc: GraphDocument }>;
}

/**
 * Fetch the field-level diff between two commits of a flow.
 * Throws on any non-OK response (surfaces the server error text).
 */
export async function diffFlow(
  id: string,
  from: string,
  to: string,
): Promise<GraphDiff> {
  const res = await fetch(
    `/api/flows/${encodeURIComponent(id)}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`diffFlow failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<GraphDiff>;
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
