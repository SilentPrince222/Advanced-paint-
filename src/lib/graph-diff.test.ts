import { describe, it, expect } from "vitest";
import { diffGraph } from "./graph-diff";
import type { GraphDocument, GraphNode, GraphEdge } from "@/lib/contract";

// ── helpers ────────────────────────────────────────────────────────────────

const n1: GraphNode = {
  id: "n1",
  type: "trigger.webhook",
  params: {},
  isDraftSafe: true,
};
const n2: GraphNode = {
  id: "n2",
  type: "condition.if",
  params: { expression: "plan == 'pro'" },
  isDraftSafe: true,
};
const n3: GraphNode = {
  id: "n3",
  type: "action.stripe.charge",
  params: { amount: 100, currency: "usd" },
  isDraftSafe: false,
};
const n4: GraphNode = {
  id: "n4",
  type: "action.slack.post",
  params: { channel: "#revenue", message: "New charge" },
  isDraftSafe: true,
};

const e1: GraphEdge = { id: "e1", fromNodeId: "n1", toNodeId: "n2" };
const e2: GraphEdge = { id: "e2", fromNodeId: "n2", toNodeId: "n3", condition: "true" };
const e3: GraphEdge = { id: "e3", fromNodeId: "n3", toNodeId: "n4" };

const emptyDoc: GraphDocument = { nodes: [], edges: [], views: [] };

function doc(...nodes: GraphNode[]): GraphDocument {
  return { nodes, edges: [], views: [] };
}
function docEdges(edges: GraphEdge[], ...nodes: GraphNode[]): GraphDocument {
  return { nodes, edges, views: [] };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("diffGraph", () => {
  it("identical docs → all sections empty", () => {
    const base: GraphDocument = { nodes: [n1, n2, n3], edges: [e1, e2], views: [] };
    const diff = diffGraph(base, base);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.modified).toEqual([]);
    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([]);
    expect(diff.edges.modified).toEqual([]);
  });

  it("empty → non-empty: all nodes added", () => {
    const diff = diffGraph(emptyDoc, doc(n1, n2));
    expect(diff.nodes.added).toEqual([n1, n2]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.modified).toEqual([]);
  });

  it("non-empty → empty: all nodes removed", () => {
    const diff = diffGraph(doc(n1, n2), emptyDoc);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([n1, n2]);
    expect(diff.nodes.modified).toEqual([]);
  });

  it("param change amount 100→90 → modified with fieldChanges", () => {
    const n3v2: GraphNode = { ...n3, params: { amount: 90, currency: "usd" } };
    const diff = diffGraph(doc(n3), doc(n3v2));
    expect(diff.nodes.modified).toHaveLength(1);
    expect(diff.nodes.modified[0].id).toBe("n3");
    expect(diff.nodes.modified[0].type).toBe("action.stripe.charge"); // AFTER type
    const amountChange = diff.nodes.modified[0].fieldChanges.find(
      (fc) => fc.field === "params.amount",
    );
    expect(amountChange).toEqual({ field: "params.amount", before: 100, after: 90 });
  });

  it("type change → modified carries AFTER type", () => {
    const n1v2: GraphNode = { ...n1, type: "trigger.schedule", params: { cron: "0 * * * *" } };
    const diff = diffGraph(doc(n1), doc(n1v2));
    expect(diff.nodes.modified).toHaveLength(1);
    expect(diff.nodes.modified[0].type).toBe("trigger.schedule");
    const typeChange = diff.nodes.modified[0].fieldChanges.find((fc) => fc.field === "type");
    expect(typeChange).toEqual({ field: "type", before: "trigger.webhook", after: "trigger.schedule" });
  });

  it("isDraftSafe change → shows in fieldChanges", () => {
    const n1v2: GraphNode = { ...n1, isDraftSafe: false };
    const diff = diffGraph(doc(n1), doc(n1v2));
    expect(diff.nodes.modified).toHaveLength(1);
    const fc = diff.nodes.modified[0].fieldChanges.find((f) => f.field === "isDraftSafe");
    expect(fc).toEqual({ field: "isDraftSafe", before: true, after: false });
  });

  it("credentialRef added (before undefined) → field change", () => {
    const n2WithCred: GraphNode = { ...n2, credentialRef: "vault-key-1" };
    const diff = diffGraph(doc(n2), doc(n2WithCred));
    expect(diff.nodes.modified).toHaveLength(1);
    const fc = diff.nodes.modified[0].fieldChanges.find((f) => f.field === "credentialRef");
    expect(fc).toBeDefined();
    expect(fc!.before).toBeUndefined();
    expect(fc!.after).toBe("vault-key-1");
  });

  it("credentialRef removed (after undefined) → field change", () => {
    const n2WithCred: GraphNode = { ...n2, credentialRef: "vault-key-1" };
    const diff = diffGraph(doc(n2WithCred), doc(n2));
    expect(diff.nodes.modified).toHaveLength(1);
    const fc = diff.nodes.modified[0].fieldChanges.find((f) => f.field === "credentialRef");
    expect(fc).toBeDefined();
    expect(fc!.before).toBe("vault-key-1");
    expect(fc!.after).toBeUndefined();
  });

  it("edge added → edges.added contains it", () => {
    const diff = diffGraph(
      docEdges([], n1, n2),
      docEdges([e1], n1, n2),
    );
    expect(diff.edges.added).toEqual([e1]);
    expect(diff.edges.removed).toEqual([]);
    expect(diff.edges.modified).toEqual([]);
  });

  it("edge removed → edges.removed contains it", () => {
    const diff = diffGraph(
      docEdges([e1], n1, n2),
      docEdges([], n1, n2),
    );
    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([e1]);
    expect(diff.edges.modified).toEqual([]);
  });

  it("edge condition change → modified", () => {
    const e2v2: GraphEdge = { ...e2, condition: "false" };
    const diff = diffGraph(
      docEdges([e2], n2, n3),
      docEdges([e2v2], n2, n3),
    );
    expect(diff.edges.modified).toHaveLength(1);
    expect(diff.edges.modified[0].id).toBe("e2");
    const fc = diff.edges.modified[0].fieldChanges.find((f) => f.field === "condition");
    expect(fc).toEqual({ field: "condition", before: "true", after: "false" });
  });

  it("edge from/to change → modified", () => {
    const e1v2: GraphEdge = { id: "e1", fromNodeId: "n2", toNodeId: "n3" };
    const diff = diffGraph(
      docEdges([e1], n1, n2),
      docEdges([e1v2], n1, n2),
    );
    expect(diff.edges.modified).toHaveLength(1);
    const fromFc = diff.edges.modified[0].fieldChanges.find((f) => f.field === "fromNodeId");
    expect(fromFc?.before).toBe("n1");
    expect(fromFc?.after).toBe("n2");
  });

  it("views differ but nodes/edges same → empty diff (views never diffed)", () => {
    const aDoc: GraphDocument = {
      nodes: [n1],
      edges: [],
      views: [{ nodeId: "n1", x: 0, y: 0, width: 160, height: 80 }],
    };
    const bDoc: GraphDocument = {
      nodes: [n1],
      edges: [],
      views: [{ nodeId: "n1", x: 999, y: 999, width: 200, height: 100 }],
    };
    const diff = diffGraph(aDoc, bDoc);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.modified).toEqual([]);
    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([]);
    expect(diff.edges.modified).toEqual([]);
  });

  it("array param change → one FieldChange for the whole array (not element-wise)", () => {
    const nA: GraphNode = { id: "x", type: "trigger.webhook", params: { tags: [1, 2] }, isDraftSafe: true };
    const nB: GraphNode = { id: "x", type: "trigger.webhook", params: { tags: [1, 3] }, isDraftSafe: true };
    const diff = diffGraph(doc(nA), doc(nB));
    expect(diff.nodes.modified).toHaveLength(1);
    expect(diff.nodes.modified[0].fieldChanges).toHaveLength(1);
    expect(diff.nodes.modified[0].fieldChanges[0]).toEqual({
      field: "params.tags",
      before: [1, 2],
      after: [1, 3],
    });
  });

  it("node reorder with same ids → empty diff", () => {
    const diff = diffGraph(doc(n1, n2, n3), doc(n3, n1, n2));
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.modified).toEqual([]);
  });

  it("multi-field change → fieldChanges sorted by field asc", () => {
    // n3 changes: amount 100→90, currency usd→eur
    const n3v2: GraphNode = { ...n3, params: { amount: 90, currency: "eur" } };
    const diff = diffGraph(doc(n3), doc(n3v2));
    const fields = diff.nodes.modified[0].fieldChanges.map((fc) => fc.field);
    expect(fields).toEqual([...fields].sort()); // must be sorted
    expect(fields).toContain("params.amount");
    expect(fields).toContain("params.currency");
  });

  it("full §8 oracle: fixture100 vs fixture90 drop-n4/e3", () => {
    const fixture100: GraphDocument = {
      nodes: [n1, n2, n3, n4],
      edges: [e1, e2, e3],
      views: [],
    };
    const n3v2: GraphNode = { ...n3, params: { amount: 90, currency: "usd" } };
    const fixture90DropN4: GraphDocument = {
      nodes: [n1, n2, n3v2],
      edges: [e1, e2],
      views: [],
    };

    const diff = diffGraph(fixture100, fixture90DropN4);

    // n3 modified with amount change
    expect(diff.nodes.modified).toHaveLength(1);
    expect(diff.nodes.modified[0].id).toBe("n3");
    const amountFc = diff.nodes.modified[0].fieldChanges.find(
      (fc) => fc.field === "params.amount",
    );
    expect(amountFc).toEqual({ field: "params.amount", before: 100, after: 90 });

    // n4 removed
    expect(diff.nodes.removed).toHaveLength(1);
    expect(diff.nodes.removed[0].id).toBe("n4");

    // e3 removed
    expect(diff.edges.removed).toHaveLength(1);
    expect(diff.edges.removed[0].id).toBe("e3");

    // inverse: fixture90 → fixture100: n4 added
    const diff2 = diffGraph(fixture90DropN4, fixture100);
    expect(diff2.nodes.added).toHaveLength(1);
    expect(diff2.nodes.added[0].id).toBe("n4");
  });
});
