import type { Edge, Node } from "@xyflow/react";
import type { GraphNode, NodeType } from "./contract";

/**
 * Runtime types for the React Flow canvas layer.
 *
 * The pure Data Contract (SPEC §2.1–2.5) lives in `lib/contract.ts`.
 * This file re-exports the contract and adds React-Flow-specific runtime
 * wrappers — the index signature that @xyflow/react's Node<T> generic
 * requires lives here, NOT in the contract.
 */

// Re-export the full contract so existing imports of GraphNode, GraphEdge, etc.
// from "lib/types" continue to work unchanged.
export * from "./contract";

// ─── Block categories ──────────────────────────────────────────────────────

export type BlockCategory = "trigger" | "action" | "condition";

/**
 * Derive a block's category from its canonical `type` (SPEC §2.1).
 * `type` is `<category>.<vendor>.<action>` — e.g. `action.stripe.charge`.
 * The category is the segment before the first dot.
 */
export function categoryOf(type: string): BlockCategory {
  const head = type.split(".", 1)[0];
  if (head === "trigger" || head === "action" || head === "condition") {
    return head;
  }
  return "action";
}

// ─── Param schema (drives the generic SidePanel form, SPEC §2.5) ────────────

export type BlockFieldType = "text" | "textarea" | "number" | "select" | "toggle";

export interface BlockFieldSchema {
  /** matches the `params` key this field reads/writes, e.g. "amount" */
  key: string;
  label: string;
  type: BlockFieldType;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
}

/** Serializable block-variant definition (no UI concerns). */
export interface BlockVariant {
  /** canonical type, e.g. `action.stripe.charge` */
  type: NodeType;
  category: BlockCategory;
  label: string;
  description?: string;
  /** config form for the SidePanel; `{}` = no configurable params */
  fields: BlockFieldSchema[];
  /** this variant needs a `credentialRef` (vault id, never a raw secret) */
  requiresCredential?: boolean;
}

// ─── React Flow runtime types (canvas-side) ────────────────────────────────

/**
 * Runtime node-data type: extends the pure contract GraphNode with an index
 * signature so @xyflow/react's Node<NodeData extends Record<string,unknown>>
 * constraint is satisfied. The index signature lives here, NOT in contract.ts.
 */
export interface BaseNodeData extends GraphNode {
  readonly [key: string]: unknown;
}

/** The React Flow node type used by the canvas. */
export type FlowNode = Node<BaseNodeData, "base">;

export interface FlowEdgeData {
  condition?: string;
  readonly [key: string]: unknown;
}
export type FlowEdge = Edge<FlowEdgeData>;
