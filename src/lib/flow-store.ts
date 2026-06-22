"use client";

import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import {
  categoryOf,
  type BaseNodeData,
  type FlowEdge,
  type FlowNode,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type NodeView,
} from "./types";
import { getVariant } from "./block-registry";

let nodeSeq = 0;

const nextNodeId = (): string => {
  nodeSeq += 1;
  return `node_${Date.now().toString(36)}_${nodeSeq}`;
};

const randomPosition = () => ({
  x: 120 + Math.random() * 320,
  y: 120 + Math.random() * 240,
});

/**
 * Build a GraphNode's default `params` from a variant's field schema
 * (SPEC §2.5): each field seeds `params[key]` with its `defaultValue`.
 */
function defaultParamsFor(type: string): Record<string, unknown> {
  const variant = getVariant(type);
  const params: Record<string, unknown> = {};
  for (const field of variant?.fields ?? []) {
    if (field.defaultValue !== undefined) {
      params[field.key] = field.defaultValue;
    }
  }
  return params;
}

export interface AddNodeOptions {
  /** canonical block type, e.g. `action.stripe.charge` */
  type: NodeType;
  position?: { x: number; y: number };
}

export interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: OnConnect;
  addNode: (options: AddNodeOptions) => string;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  setNodes: (nodes: FlowNode[]) => void;
  setEdges: (edges: FlowEdge[]) => void;
  /** update a logic field on a node (params / credentialRef / isDraftSafe) */
  updateNodeData: (id: string, patch: Partial<GraphNode>) => void;
  /** serialize the canvas to the two-layer Data Contract (SPEC §2.1) */
  toGraphDocument: () => GraphDocument;
  /** load a GraphDocument back onto the canvas */
  fromGraphDocument: (document: GraphDocument) => void;
}

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: [],
  edges: [],

  onNodesChange: (changes: NodeChange<FlowNode>[]) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) as FlowNode[] });
  },

  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => {
    set({ edges: applyEdgeChanges(changes, get().edges) as FlowEdge[] });
  },

  onConnect: (connection: Connection) => {
    // Reject self-loops: a node wired to itself is never a meaningful flow.
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    set({
      edges: addEdge(
        { ...connection, type: "smoothstep", animated: true },
        get().edges,
      ) as FlowEdge[],
    });
  },

  addNode: ({ type, position }) => {
    const id = nextNodeId();
    const variant = getVariant(type);
    // Default draft-safety per SPEC §6.0: irreversible actions (stripe.charge)
    // are NOT draft-safe; everything else is.
    const isDraftSafe = variant?.requiresCredential !== true;

    // pin 3a: intermediate must be BaseNodeData (not GraphNode) so data: logic
    // assigns to FlowNode which requires Node<BaseNodeData>.
    const logic: BaseNodeData = {
      id,
      type,
      params: defaultParamsFor(type),
      isDraftSafe,
    };

    const node: FlowNode = {
      id,
      type: "base",
      position: position ?? randomPosition(),
      data: logic,
    };

    set({ nodes: [...get().nodes, node] });
    return id;
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((node) => node.id !== id),
      edges: get().edges.filter(
        (edge) => edge.source !== id && edge.target !== id,
      ),
    });
  },

  removeEdge: (id) => {
    set({ edges: get().edges.filter((edge) => edge.id !== id) });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  updateNodeData: (id, patch) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, ...patch } as BaseNodeData }
          : node,
      ),
    });
  },

  toGraphDocument: () => {
    const { nodes, edges } = get();
    const logicNodes: GraphNode[] = nodes.map((node) => {
      const { id, data } = node;
      // Strip React Flow's transient metadata: keep only logic-layer fields.
      const { type, params, credentialRef, isDraftSafe } = data;
      const logic: GraphNode = {
        id,
        type,
        params: { ...params },
        isDraftSafe,
      };
      if (credentialRef !== undefined) logic.credentialRef = credentialRef;
      return logic;
    });

    const logicEdges: GraphEdge[] = edges.map((edge) => {
      const logic: GraphEdge = {
        id: edge.id,
        fromNodeId: edge.source,
        toNodeId: edge.target,
      };
      const condition = edge.data?.condition;
      if (condition !== undefined) logic.condition = condition;
      return logic;
    });

    // pin 3c: emit required width/height from RF node geometry (default 160×80
    // per SPEC DDL §3 defaults). color is not tracked yet — omit it.
    const views: NodeView[] = nodes.map((node) => ({
      nodeId: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? 160,
      height: node.height ?? 80,
    }));

    return { nodes: logicNodes, edges: logicEdges, views };
  },

  fromGraphDocument: (document) => {
    const viewByNodeId = new Map(document.views.map((v) => [v.nodeId, v]));
    const nodes: FlowNode[] = document.nodes.map((logic) => {
      const view = viewByNodeId.get(logic.id);
      // Coerce missing `isDraftSafe` to the SPEC §6.0 default (true) so a
      // document loaded from JSON / an older snapshot still satisfies the
      // GraphNode boolean contract instead of carrying `undefined`.
      const isDraftSafe = logic.isDraftSafe ?? true;
      // pin 3b: cast to BaseNodeData (has index sig) so the RF Node accepts it.
      return {
        id: logic.id,
        type: "base",
        position: { x: view?.x ?? 0, y: view?.y ?? 0 },
        // pin 3b: also propagate width/height from the view so the round-trip
        // restores geometry (default 160×80 per SPEC DDL §3).
        width: view?.width ?? 160,
        height: view?.height ?? 80,
        data: { ...logic, isDraftSafe } as BaseNodeData,
      };
    });
    // Drop orphan edges: a document from the backend or a corrupted snapshot
    // may carry an edge whose endpoint was removed. Loading it verbatim would
    // produce a dangling React Flow edge pointing at a non-existent node.
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: FlowEdge[] = document.edges
      .filter(
        (logic) => nodeIds.has(logic.fromNodeId) && nodeIds.has(logic.toNodeId),
      )
      .map((logic) => ({
        id: logic.id,
        source: logic.fromNodeId,
        target: logic.toNodeId,
        type: "smoothstep",
        animated: true,
        data: logic.condition !== undefined ? { condition: logic.condition } : {},
      }));
    set({ nodes, edges });
  },
}));

// Re-export for callers that derive UI purely from a node's `type`.
export { categoryOf };
