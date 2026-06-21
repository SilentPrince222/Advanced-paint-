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
  type FlowEdge,
  type FlowNode,
  type GraphDocument,
  type LogicEdge,
  type LogicNode,
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
 * Build a LogicNode's default `params` from a variant's field schema
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
  type: string;
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
  updateNodeData: (id: string, patch: Partial<LogicNode>) => void;
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

    const logic: LogicNode = {
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
          ? { ...node, data: { ...node.data, ...patch } as LogicNode }
          : node,
      ),
    });
  },

  toGraphDocument: () => {
    const { nodes, edges } = get();
    const logicNodes: LogicNode[] = nodes.map((node) => {
      const { id, data } = node;
      // Strip React Flow's transient metadata: keep only logic-layer fields.
      const { type, params, credentialRef, isDraftSafe } = data;
      const logic: LogicNode = {
        id,
        type,
        params: { ...params },
        isDraftSafe,
      };
      if (credentialRef !== undefined) logic.credentialRef = credentialRef;
      return logic;
    });

    const logicEdges: LogicEdge[] = edges.map((edge) => {
      const logic: LogicEdge = {
        id: edge.id,
        fromNodeId: edge.source,
        toNodeId: edge.target,
      };
      const condition = edge.data?.condition;
      if (condition !== undefined) logic.condition = condition;
      return logic;
    });

    const views: NodeView[] = nodes.map((node) => {
      const view: NodeView = {
        nodeId: node.id,
        x: node.position.x,
        y: node.position.y,
      };
      // width/height/color are optional — omitted unless set.
      return view;
    });

    return { nodes: logicNodes, edges: logicEdges, views };
  },

  fromGraphDocument: (document) => {
    const viewByNodeId = new Map(document.views.map((v) => [v.nodeId, v]));
    const nodes: FlowNode[] = document.nodes.map((logic) => {
      const view = viewByNodeId.get(logic.id);
      return {
        id: logic.id,
        type: "base",
        position: { x: view?.x ?? 0, y: view?.y ?? 0 },
        data: { ...logic },
      };
    });
    const edges: FlowEdge[] = document.edges.map((logic) => ({
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
