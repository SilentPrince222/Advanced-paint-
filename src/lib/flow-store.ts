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
  type GraphNode,
  type NodeType,
} from "./types";
import { getVariant, defaultParamsFor } from "./block-registry";
import { fromGraphDocument, toGraphDocument } from "./graph-serialize";

let nodeSeq = 0;

const nextNodeId = (): string => {
  nodeSeq += 1;
  return `node_${Date.now().toString(36)}_${nodeSeq}`;
};

const randomPosition = () => ({
  x: 120 + Math.random() * 320,
  y: 120 + Math.random() * 240,
});

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
  /** merge one key into a node's params */
  updateNodeParam: (id: string, key: string, value: unknown) => void;
  /** set or clear a node's credentialRef */
  setCredentialRef: (id: string, credentialRef: string | undefined) => void;
  /** serialize the canvas to the two-layer Data Contract (SPEC §2.1) */
  toGraphDocument: () => GraphDocument;
  /** load a GraphDocument back onto the canvas */
  fromGraphDocument: (document: GraphDocument) => void;
  /** active branch id; undefined ≡ main ≡ no `?branch=` (run 3b-2). */
  currentBranchId: string | undefined;
  setCurrentBranchId: (id: string | undefined) => void;
  /** nonce to force ExecLogViewer re-fetch after runs/rollbacks */
  execLogNonce: number;
  bumpExecLog: () => void;
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

  updateNodeParam: (id, key, value) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    get().updateNodeData(id, {
      params: { ...node.data.params, [key]: value },
    });
  },

  setCredentialRef: (id, credentialRef) => {
    get().updateNodeData(id, { credentialRef });
  },

  toGraphDocument: () => toGraphDocument(get().nodes, get().edges),

  fromGraphDocument: (document) => {
    set(fromGraphDocument(document));
  },

  currentBranchId: undefined,
  setCurrentBranchId: (id) => set({ currentBranchId: id }),

  execLogNonce: 0,
  bumpExecLog: () => {
    const next = get().execLogNonce + 1;
    set({ execLogNonce: next });
  },
}));

// Re-export for callers that derive UI purely from a node's `type`.
export { categoryOf };
