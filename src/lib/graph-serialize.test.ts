import { describe, expect, it } from "vitest";
import { toGraphDocument, fromGraphDocument } from "./graph-serialize";
import type { GraphDocument } from "./types";

describe("graph-serialize — round-trip", () => {
  it("preserves nodes, params, credentialRef, draft-safety, positions, edges", () => {
    const doc: GraphDocument = {
      nodes: [
        {
          id: "n1",
          type: "trigger.schedule",
          params: { cron: "0 9 * * MON" },
          isDraftSafe: true,
        },
        {
          id: "n2",
          type: "action.stripe.charge",
          params: { amount: 100, currency: "usd" },
          credentialRef: "demo/stripe-test",
          isDraftSafe: false,
        },
      ],
      edges: [{ id: "e1", fromNodeId: "n1", toNodeId: "n2" }],
      views: [
        { nodeId: "n1", x: 10, y: 20, width: 160, height: 80 },
        { nodeId: "n2", x: 30, y: 40, width: 200, height: 100 },
      ],
    };

    const { nodes, edges } = fromGraphDocument(doc);
    const back = toGraphDocument(nodes, edges);

    expect(back.nodes).toEqual(doc.nodes);
    expect(back.views).toEqual(doc.views);
    expect(back.edges).toEqual(doc.edges);
  });

  it("preserves a condition label through the round-trip", () => {
    const doc: GraphDocument = {
      nodes: [
        { id: "c", type: "condition.if", params: { expression: "x" }, isDraftSafe: true },
        { id: "t", type: "action.slack.post", params: {}, isDraftSafe: false },
      ],
      edges: [{ id: "e", fromNodeId: "c", toNodeId: "t", condition: "true" }],
      views: [
        { nodeId: "c", x: 0, y: 0, width: 160, height: 80 },
        { nodeId: "t", x: 1, y: 1, width: 160, height: 80 },
      ],
    };

    const { nodes, edges } = fromGraphDocument(doc);
    const back = toGraphDocument(nodes, edges);

    expect(back.edges).toEqual(doc.edges);
  });
});

describe("graph-serialize — fromGraphDocument defensive normalization", () => {
  it("defaults isDraftSafe to true when the loaded node omits it", () => {
    const doc = {
      nodes: [{ id: "n1", type: "trigger.webhook", params: {} }],
      edges: [],
      views: [{ nodeId: "n1", x: 0, y: 0, width: 160, height: 80 }],
    } as unknown as GraphDocument;

    const { nodes } = fromGraphDocument(doc);

    expect(nodes[0].data.isDraftSafe).toBe(true);
  });

  it("keeps an explicit isDraftSafe: false", () => {
    const doc = {
      nodes: [
        { id: "n1", type: "action.stripe.charge", params: {}, isDraftSafe: false },
      ],
      edges: [],
      views: [{ nodeId: "n1", x: 0, y: 0, width: 160, height: 80 }],
    } as unknown as GraphDocument;

    const { nodes } = fromGraphDocument(doc);

    expect(nodes[0].data.isDraftSafe).toBe(false);
  });

  it("drops edges that reference nodes not in the document", () => {
    const doc = {
      nodes: [
        { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n1" },
        { id: "e2", fromNodeId: "n1", toNodeId: "GONE" },
        { id: "e3", fromNodeId: "ALSO_GONE", toNodeId: "n1" },
      ],
      views: [{ nodeId: "n1", x: 0, y: 0, width: 160, height: 80 }],
    } as unknown as GraphDocument;

    const { nodes, edges } = fromGraphDocument(doc);
    const nodeIds = new Set(nodes.map((n) => n.id));

    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe("e1");
    expect(nodeIds.has(edges[0].source)).toBe(true);
    expect(nodeIds.has(edges[0].target)).toBe(true);
  });

  it("positions a node at (0,0) when its view is missing", () => {
    const docNoViews: GraphDocument = {
      nodes: [
        { id: "x", type: "trigger.webhook", params: {}, isDraftSafe: true },
      ],
      edges: [],
      views: [],
    };
    const loaded = fromGraphDocument(docNoViews);
    expect(loaded.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("applies default 160×80 geometry when the view omits width/height", () => {
    // NodeView.width/height are required in the contract, but a legacy doc
    // may slip through without them — fromGraphDocument must still produce a
    // valid RF node with sensible defaults.
    const doc = {
      nodes: [{ id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true }],
      edges: [],
      views: [{ nodeId: "n1", x: 5, y: 5 }],
    } as unknown as GraphDocument;

    const { nodes } = fromGraphDocument(doc);

    expect(nodes[0].width).toBe(160);
    expect(nodes[0].height).toBe(80);
  });
});
