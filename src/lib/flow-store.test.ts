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

/**
 * Store-level behavior tests. Pure (de)serialization logic lives in
 * `graph-serialize.test.ts`; these cover Zustand-side wiring:
 *  - onConnect dedupe + self-loop guard
 *  - addNode / updateNodeData
 *  - thin delegation of toGraphDocument / fromGraphDocument
 */
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

  describe("addNode", () => {
    it("seeds params from the variant's field defaults", () => {
      const { addNode } = useFlowStore.getState();
      addNode({ type: "action.stripe.charge" });

      const node = useFlowStore.getState().nodes[0];
      expect(node.data.params).toEqual({ amount: 100, currency: "usd" });
    });

    it("marks requiresCredential variants as draft-unsafe by default", () => {
      const { addNode } = useFlowStore.getState();
      addNode({ type: "action.stripe.charge" });

      expect(useFlowStore.getState().nodes[0].data.isDraftSafe).toBe(false);
    });

    it("marks non-credential triggers as draft-safe by default", () => {
      const { addNode } = useFlowStore.getState();
      addNode({ type: "trigger.schedule" });

      expect(useFlowStore.getState().nodes[0].data.isDraftSafe).toBe(true);
    });
  });

  describe("updateNodeData", () => {
    it("merges a patch into the node's data without touching other nodes", () => {
      const { addNode, updateNodeData } = useFlowStore.getState();
      const a = addNode({ type: "action.stripe.charge" });
      const b = addNode({ type: "action.slack.post" });

      updateNodeData(a, { params: { amount: 250, currency: "usd" } });

      const state = useFlowStore.getState();
      expect(state.nodes.find((n) => n.id === a)!.data.params).toEqual({
        amount: 250,
        currency: "usd",
      });
      // b untouched
      expect(state.nodes.find((n) => n.id === b)!.data.params).toEqual({
        channel: "#revenue",
        message: "New charge received.",
      });
    });
  });

  describe("serialization delegation (thin wire)", () => {
    it("store.toGraphDocument / fromGraphDocument round-trip through graph-serialize", () => {
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
            isDraftSafe: false,
          },
        ],
        edges: [{ id: "e1", fromNodeId: "n1", toNodeId: "n2" }],
        views: [
          { nodeId: "n1", x: 10, y: 20, width: 160, height: 80 },
          { nodeId: "n2", x: 30, y: 40, width: 160, height: 80 },
        ],
      };

      useFlowStore.getState().fromGraphDocument(doc);
      const out = useFlowStore.getState().toGraphDocument();

      expect(out).toEqual(doc);
    });
  });
});
