/**
 * Data Contract — byte-faithful to SPEC §2.1–2.5.
 * Shared between frontend and backend. Neither side edits this alone.
 *
 * DO NOT import React Flow types here. This file must stay pure so the
 * backend can import it without pulling in the React-side bundle.
 */

import { z } from "zod";

// ── §2.1 Logic layer (what runs) ──────────────────────────────────────────

export type NodeType =
  | "trigger.schedule"
  | "trigger.webhook"
  | "action.stripe.charge"
  | "action.slack.post"
  | "condition.if";

export interface GraphNode {
  id: string;                       // stable, client-generated (nanoid). Survives across commits → diff anchors on it.
  type: NodeType;
  params: Record<string, unknown>;  // per-type config. NEVER put a raw secret/token here — use credentialRef.
                                    //   Enforced by a per-type zod allowlist at the API boundary (see §2.5).
  credentialRef?: string;           // opaque vault id — NEVER a raw secret
  isDraftSafe: boolean;             // false for action.stripe.charge
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  condition?: string;               // optional guard expression, e.g. "true" / "false" branch label
}

// ── §2.1 Presentation layer (where it sits) ──────────────────────────────

export interface NodeView {
  nodeId: string;                   // same id as the logic node
  x: number; y: number;
  width: number; height: number;
  color?: string;
}

// ── §2.1 What canvas <-> API actually exchange ───────────────────────────

export interface GraphDocument {
  nodes: GraphNode[];
  edges: GraphEdge[];
  views: NodeView[];
}

// ── §2.2 Version envelope ─────────────────────────────────────────────────

export interface Commit {
  id: string;                       // server-generated nanoid — NOT a content hash, so re-rolling
                                    //   back to an identical state is always a fresh commit (no PK clash).
                                    //   Stored as column `commit.graph_snapshot` (supersedes the roadmap's `graphSnapshotRef`).
  flowId: string;
  branchId: string;
  parentId: string | null;          // DAG
  authorNote: string;
  createdAt: string;                // ISO
  graphSnapshot: GraphDocument;     // FULL snapshot — decision #1 ("photos")
}

export interface Branch {
  id: string;
  flowId: string;
  name: string;
  headCommitId: string | null;
  baseCommitId: string | null;
}

// ── §2.3 Diff (field-level — decision #3) & Exec log ─────────────────────

export interface FieldChange { field: string; before: unknown; after: unknown; }

export interface GraphDiff {
  nodes: {
    added: GraphNode[];
    removed: GraphNode[];
    modified: { id: string; type: NodeType; fieldChanges: FieldChange[] }[];
  };
  edges: {
    added: GraphEdge[];
    removed: GraphEdge[];
    modified: { id: string; fieldChanges: FieldChange[] }[];
  };
  // NOTE: views are never diffed.
}

export interface ExecLogEntry {
  id: string;                       // nanoid; also used as the Stripe Idempotency-Key (see §6.2)
  flowId: string;
  commitId: string;                 // which version was live when this ran
  nodeId: string;
  actionType: NodeType;
  request: Record<string, unknown>; // secret-free (credentialRef only, never the resolved secret)
  response: Record<string, unknown>;
  status: "success" | "failure";
  createdAt: string;
  // prevHash?/rowHash? — hash-chain is an optional stretch; NOT in the demo DDL (§3).
}

// ── §2.1 helpers ──────────────────────────────────────────────────────────

export const NODE_TYPES: readonly NodeType[] = [
  "trigger.schedule",
  "trigger.webhook",
  "action.stripe.charge",
  "action.slack.post",
  "condition.if",
] as const;

export function isNodeType(s: string): s is NodeType {
  return (NODE_TYPES as readonly string[]).includes(s);
}

// ── §2.5 Per-type param schemas (drive validation + SidePanel) ────────────
//
// One zod schema per NodeType — the allowlist that keeps secrets out of
// `params` (§2.1) and the config that generates <SidePanel> forms generically.
//
//   trigger.webhook       {}                                   // payload comes from the inbound request
//   trigger.schedule      { cron: string }
//   condition.if          { expression: string }               // e.g. "plan == 'pro'"
//   action.stripe.charge  { amount: number, currency: string } // credential via credentialRef, NOT params
//   action.slack.post     { channel: string, message: string } // credential via credentialRef, NOT params

export const paramSchemas = {
  "trigger.webhook": z.strictObject({}),
  "trigger.schedule": z.strictObject({ cron: z.string() }),
  "condition.if": z.strictObject({ expression: z.string() }),
  "action.stripe.charge": z.strictObject({ amount: z.number().int().nonnegative(), currency: z.string() }),
  "action.slack.post": z.strictObject({ channel: z.string(), message: z.string() }),
} satisfies Record<NodeType, z.ZodType>;
