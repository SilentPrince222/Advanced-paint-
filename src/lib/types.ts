import type { Edge, Node } from "@xyflow/react";

/**
 * Shared schema for the automation builder.
 *
 * Keep all node/edge data shapes here so later phases (block variants,
 * version snapshots, diffs) don't require refactors across the codebase.
 */

export type BlockCategory = "trigger" | "action" | "condition";

/**
 * Field descriptor used by the schema-driven form renderer (Phase 3).
 * Declared now so block variants can carry their config schema from Phase 2.
 */
export type BlockFieldType = "text" | "number" | "select" | "toggle";

export interface BlockFieldSchema {
  id: string;
  label: string;
  type: BlockFieldType;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
}

/**
 * Definition of a block variant. The registry lives in `block-registry.ts`
 * (Phase 2) and is keyed by `variantId`.
 */
export interface BlockVariant {
  variantId: string;
  category: BlockCategory;
  label: string;
  description?: string;
  icon?: string;
  fields?: BlockFieldSchema[];
}

/**
 * Per-node runtime data stored on the canvas (and in version snapshots).
 *
 * `config` is intentionally a free-form record keyed by field id so the
 * Phase 3 form renderer can read/write values generically.
 */
export interface BaseNodeData {
  category: BlockCategory;
  variantId: string;
  label: string;
  config: Record<string, unknown>;
  // Allow React Flow's helpers to attach transient metadata without TS errors.
  readonly [key: string]: unknown;
}

export type FlowNode = Node<BaseNodeData, "base">;
export type FlowEdge = Edge;

/** A serializable snapshot of the whole canvas. Used by Phase 4+ (history). */
export interface CanvasSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
