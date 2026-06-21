import { beforeEach, describe, expect, it } from "vitest";
import { useFlowStore } from "./flow-store";
import type { Connection } from "@xyflow/react";
import type { GraphDocument } from "./types";

function reset() {
  useFlowStore.setState({ nodes: [], edges: [] });
}

function connect(sourceId: string, targetId: string) {
  const connection: Connection = {
    source: sourceId,
    target: targetId,
    sourceHandle: null,
    targetHandle: null,
  };
  useFlowStore.getState().onConnect(connection);
}

describe("flow-store", () => {
  beforeEach(reset);

  // Regression guard: addEdge() already dedupes via connectionExists.
  // This test documents that contract so a future swap can't silently regress.
  describe("onConnect — duplicate edges are rejected by addEdge", () => {
    it("does NOT create a second edge for the same source+target", () => {
      const { addNode, onConnect } = useFlowStore.getState();
      const a = addNode({ type: "trigger.webhook" });
      const b = addNode({ type: "action.slack.post" });

      onConnect({
        source: a,
        target: b,
        sourceHandle: null,
        targetHandle: null,
      });
      onConnect({
        source: a,
        target: b,
        sourceHandle: null,
        targetHandle: null,
      });

      expect(useFlowStore.getState().edges).toHaveLength(1);
    });

    it("still allows distinct connections", () => {
      const { addNode } = useFlowStore.getState();
      const a = addNode({ type: "trigger.webhook" });
      const b = addNode({ type: "action.slack.post" });
      const c = addNode({ type: "action.stripe.charge" });

      connect(a, b);
      connect(a, c);

      expect(useFlowStore.getState().edges).toHaveLength(2);
    });
  });

  describe("onConnect — self-loops (bug #2)", () => {
    it("rejects a connection from a node to itself", () => {
      const { addNode } = useFlowStore.getState();
      const a = addNode({ type: "action.slack.post" });

      connect(a, a);

      expect(useFlowStore.getState().edges).toHaveLength(0);
    });
  });

  describe("fromGraphDocument — isDraftSafe default (bug #3)", () => {
    it("defaults isDraftSafe to true when the loaded node omits it", () => {
      // Real-world documents (backend JSON, older snapshots, diff fixtures)
      // may omit isDraftSafe. The loaded node must satisfy LogicNode's
      // `boolean` contract and SPEC §6.0's default-safe rule.
      const doc = {
        nodes: [
          { id: "n1", type: "trigger.webhook", params: {} },
          { id: "n2", type: "action.stripe.charge", params: {}, isDraftSafe: false },
        ],
        edges: [],
        views: [
          { nodeId: "n1", x: 0, y: 0 },
          { nodeId: "n2", x: 100, y: 100 },
        ],
      } as unknown as GraphDocument;

      useFlowStore.getState().fromGraphDocument(doc);

      const nodes = useFlowStore.getState().nodes;
      expect(nodes[0].data.isDraftSafe).toBe(true);
      expect(nodes[1].data.isDraftSafe).toBe(false);
    });
  });

  describe("fromGraphDocument — orphan edges (bug #4)", () => {
    it("drops edges that reference nodes not in the document", () => {
      // A document from the backend / a corrupted snapshot may carry an edge
      // whose endpoint node was removed. Loading it verbatim produces a
      // dangling React Flow edge pointing at a non-existent node.
      const doc = {
        nodes: [
          { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
        ],
        edges: [
          { id: "e1", fromNodeId: "n1", toNodeId: "n1" },
          { id: "e2", fromNodeId: "n1", toNodeId: "GONE" },
          { id: "e3", fromNodeId: "ALSO_GONE", toNodeId: "n1" },
        ],
        views: [{ nodeId: "n1", x: 0, y: 0 }],
      } as unknown as GraphDocument;

      useFlowStore.getState().fromGraphDocument(doc);

      const { nodes, edges } = useFlowStore.getState();
      const nodeIds = new Set(nodes.map((n) => n.id));
      // only e1 (n1 -> n1 endpoints exist) survives; e2/e3 are dropped.
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe("e1");
      expect(nodeIds.has(edges[0].source)).toBe(true);
      expect(nodeIds.has(edges[0].target)).toBe(true);
    });
  });

  describe("toGraphDocument / fromGraphDocument round-trip", () => {
    it("preserves nodes, params, draft-safety, positions and edge conditions", () => {
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
        edges: [
          { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
        ],
        views: [
          { nodeId: "n1", x: 10, y: 20 },
          { nodeId: "n2", x: 30, y: 40 },
        ],
      };

      useFlowStore.getState().fromGraphDocument(doc);
      const roundTripped = useFlowStore.getState().toGraphDocument();

      // nodes preserved with all logic fields
      expect(roundTripped.nodes).toEqual(doc.nodes);
      // views preserved (positions)
      expect(roundTripped.views).toEqual(doc.views);
      // edges preserved
      expect(roundTripped.edges).toEqual(doc.edges);
    });

    it("preserves a condition label through the round-trip", () => {
      const doc: GraphDocument = {
        nodes: [
          { id: "c", type: "condition.if", params: { expression: "x" }, isDraftSafe: true },
          { id: "t", type: "action.slack.post", params: {}, isDraftSafe: false },
        ],
        edges: [{ id: "e", fromNodeId: "c", toNodeId: "t", condition: "true" }],
        views: [
          { nodeId: "c", x: 0, y: 0 },
          { nodeId: "t", x: 1, y: 1 },
        ],
      };

      useFlowStore.getState().fromGraphDocument(doc);
      const out = useFlowStore.getState().toGraphDocument();

      expect(out.edges).toEqual(doc.edges);
    });
  });
});
