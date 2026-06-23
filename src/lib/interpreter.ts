import type { GraphDocument, GraphNode, NodeType } from "@/lib/contract";

/**
 * Pure graph interpreter — Rung 1 "It runs".
 *
 * Design constraints:
 * - PURE: type-only imports from the Data Contract. NO "server-only", NO crypto,
 *   NO DB. Unit-testable from vitest without any guard (like graph-serialize).
 * - Deterministic: ids (execId) are minted by the caller (the route) and passed
 *   into mockResponse, so the trace is reproducible given the same inputs.
 * - BFS from the first trigger; visited-set guards cycles; disconnected nodes are
 *   never enqueued so they never appear in steps.
 * - Every reached action mock-fires on the single demo `main` branch. The
 *   draft-safety gate (isDraftSafe) is Rung 4/6 DoD — stays in data, unused here.
 */

export type StepKind = "trigger" | "condition" | "action";

export interface NodeStep {
  nodeId: string;
  type: NodeType;
  kind: StepKind;
  request: Record<string, unknown>;
}

export interface RunTrace {
  startNodeId: string | null;
  steps: NodeStep[];
}

function kindOf(type: NodeType): StepKind {
  if (type.startsWith("trigger.")) return "trigger";
  if (type.startsWith("action.")) return "action";
  return "condition";
}

/**
 * Secret-free request payload per node type. NEVER includes credentialRef or any
 * resolved secret (ExecLogEntry.request is secret-free by contract §2.3).
 */
function toRequest(node: GraphNode): Record<string, unknown> {
  const p = node.params ?? {};
  switch (node.type) {
    case "action.stripe.charge":
      return { amount: p.amount, currency: p.currency };
    case "action.slack.post":
      return { channel: p.channel, message: p.message };
    case "trigger.schedule":
      return { cron: p.cron };
    case "condition.if":
      return { expression: p.expression ?? null, result: true };
    case "trigger.webhook":
      return {};
    default:
      return {};
  }
}

function toStep(node: GraphNode): NodeStep {
  return {
    nodeId: node.id,
    type: node.type,
    kind: kindOf(node.type),
    request: toRequest(node),
  };
}

/**
 * Choose which outgoing edges to follow from a node.
 *
 * condition.if with explicitly labeled "true"/"false" edges → follow only the
 * "true" branch(es) (the demo is always-true, SPEC §6.1). Otherwise follow all
 * outgoing edges.
 */
function chooseEdges(
  node: GraphNode,
  outgoing: GraphDocument["edges"],
): GraphDocument["edges"] {
  if (
    node.type === "condition.if" &&
    outgoing.some((e) => e.condition === "true" || e.condition === "false")
  ) {
    return outgoing.filter((e) => e.condition === "true");
  }
  return outgoing;
}

export function runGraph(
  doc: GraphDocument,
  opts?: { fromNodeId?: string },
): RunTrace {
  const byId = new Map<string, GraphNode>(doc.nodes.map((n) => [n.id, n]));

  const start =
    (opts?.fromNodeId ? byId.get(opts.fromNodeId) : undefined) ??
    doc.nodes.find((n) => n.type.startsWith("trigger."));

  if (!start) return { startNodeId: null, steps: [] };

  const steps: NodeStep[] = [];
  const visited = new Set<string>([start.id]); // mark on ENQUEUE → cycle-safe
  const queue: string[] = [start.id];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const node = byId.get(id);
    if (!node) continue; // dangling edge target — skip

    steps.push(toStep(node));

    const outgoing = doc.edges.filter((e) => e.fromNodeId === id);
    for (const e of chooseEdges(node, outgoing)) {
      if (!visited.has(e.toNodeId)) {
        visited.add(e.toNodeId);
        queue.push(e.toNodeId);
      }
    }
  }

  return { startNodeId: start.id, steps };
}

/**
 * Deterministic mock response for an action, keyed off the caller-minted execId
 * (so the route can build the persisted response and the trace from one id).
 * `mock: true` is load-bearing — the frontend [MOCK] badge reads it.
 */
export function mockResponse(
  type: NodeType,
  execId: string,
): Record<string, unknown> {
  switch (type) {
    case "action.stripe.charge":
      return { chargeId: "mock_ch_" + execId.slice(0, 8), mock: true };
    case "action.slack.post":
      return { ok: true, ts: execId, mock: true };
    default:
      return { mock: true };
  }
}
