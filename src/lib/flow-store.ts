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
import type { BlockCategory, FlowEdge, FlowNode } from "./types";

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
  category?: BlockCategory;
  variantId?: string;
  label?: string;
  position?: { x: number; y: number };
}

export interface FlowState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  onConnect: OnConnect;
  addNode: (options?: AddNodeOptions) => string;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  setNodes: (nodes: FlowNode[]) => void;
  setEdges: (edges: FlowEdge[]) => void;
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

  addNode: (options) => {
    const id = nextNodeId();
    const category = options?.category ?? "action";
    const variantId = options?.variantId ?? "action.create-task";
    const label = options?.label ?? "Block";
    const position = options?.position ?? randomPosition();

    const node: FlowNode = {
      id,
      type: "base",
      position,
      data: {
        category,
        variantId,
        label,
        config: {},
      },
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
}));
