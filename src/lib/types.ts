import type { Edge, Node } from "@xyflow/react";

/**
 * Shared schema for the automation builder — the Data Contract (SPEC §2).
 *
 * Two layers, linked by stable node id:
 *   - LOGIC layer  (what runs):     LogicNode / LogicEdge
 *   - PRESENTATION layer (where):   NodeView
 *
 * The split is deliberate (SPEC §2.1): moving a block (view change) and
 * changing its logic are independent classes of change. The diff engine
 * (Phase 5) operates on the LOGIC layer only — position changes are NEVER
 * flagged as a meaningful diff.
 *
 * Keep all graph shapes here so Phase 3–5 (SidePanel, history, diff) and the
 * backend contract share one source of truth.
 */

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
  type: string;
  category: BlockCategory;
  label: string;
  description?: string;
  /** config form for the SidePanel; `{}` = no configurable params */
  fields: BlockFieldSchema[];
  /** this variant needs a `credentialRef` (vault id, never a raw secret) */
  requiresCredential?: boolean;
}

// ─── LOGIC layer (SPEC §2.1) — the Data Contract with the backend ──────────

export interface LogicNode {
  id: string;
  /** canonical block type, e.g. `trigger.webhook` / `action.stripe.charge` */
  type: string;
  /** per-type config; secrets NEVER live here (use `credentialRef`) */
  params: Record<string, unknown>;
  /** opaque vault id; the spec mandates this exists from day one */
  credentialRef?: string;
  /** may this node execute in a draft/branch context? default true */
  isDraftSafe: boolean;
  // React Flow helpers attach transient metadata; allow it without TS errors.
  readonly [key: string]: unknown;
}

export interface LogicEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** label for condition branches, e.g. "true" / "false" */
  condition?: string;
  readonly [key: string]: unknown;
}

// ─── PRESENTATION layer (SPEC §2.1) ─────────────────────────────────────────

export interface NodeView {
  nodeId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: string;
}

// ─── The full graph document (what gets saved / snapshotted / diffed) ───────

export interface GraphDocument {
  nodes: LogicNode[];
  edges: LogicEdge[];
  views: NodeView[];
}

// ─── React Flow runtime types (canvas-side) ────────────────────────────────

/** The data React Flow carries per node — IS the logic layer. */
export type FlowNode = Node<LogicNode, "base">;

export interface FlowEdgeData {
  condition?: string;
  readonly [key: string]: unknown;
}
export type FlowEdge = Edge<FlowEdgeData>;

// ─── Version snapshot (Phase 4) ─────────────────────────────────────────────

export interface CanvasSnapshot {
  /** monotonically increasing within the session */
  seq: number;
  createdAt: string;
  note?: string;
  document: GraphDocument;
}
