import {
  Clock,
  Filter,
  GitBranch,
  ListTodo,
  Mail,
  type LucideIcon,
  Webhook,
  Send,
  MessageSquare,
} from "lucide-react";
import type { BlockCategory, BlockVariant } from "./types";

/**
 * UI metadata layered on top of the serializable `BlockVariant`.
 * Lives only in code (never serialized), so snapshots stay clean.
 */
export interface UiBlockVariant extends BlockVariant {
  /** lucide icon component rendered on the node and in the palette */
  icon: LucideIcon;
}

/**
 * Per-category visual accent. Kept here (UI-only) so the node renderer and
 * the palette share a single source of truth.
 */
export interface CategoryStyle {
  /** tailwind classes for the colored chip / dot */
  chip: string;
  dot: string;
  /** ring color used on the node card */
  ring: string;
  /** handle color (source/target dots) */
  handle: string;
  /** human label for the category */
  label: string;
}

export const CATEGORY_STYLES: Record<BlockCategory, CategoryStyle> = {
  trigger: {
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/40",
    handle: "!bg-emerald-500",
    label: "Trigger",
  },
  action: {
    chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
    ring: "ring-blue-500/40",
    handle: "!bg-blue-500",
    label: "Action",
  },
  condition: {
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    ring: "ring-amber-500/40",
    handle: "!bg-amber-500",
    label: "Condition",
  },
};

/**
 * The canonical block registry.
 *
 * Phase 2 ships a small fixed set of sample variants per category. Real
 * integration logic is out of scope — these are placeholders. Phase 3 will
 * attach `fields` (config schema) to each variant for the form renderer.
 */
export const BLOCK_REGISTRY: UiBlockVariant[] = [
  // ── Triggers ──────────────────────────────────────────────────────────
  {
    variantId: "trigger.email-received",
    category: "trigger",
    label: "Email Received",
    description: "Fires when a new email lands in the connected mailbox.",
    icon: Mail,
  },
  {
    variantId: "trigger.schedule",
    category: "trigger",
    label: "Schedule",
    description: "Fires on a cron-style schedule (e.g. every Monday 9:00).",
    icon: Clock,
  },
  {
    variantId: "trigger.webhook",
    category: "trigger",
    label: "Webhook",
    description: "Fires when an external service calls the webhook URL.",
    icon: Webhook,
  },

  // ── Actions ───────────────────────────────────────────────────────────
  {
    variantId: "action.send-slack",
    category: "action",
    label: "Send Slack Message",
    description: "Posts a message to a Slack channel.",
    icon: Send,
  },
  {
    variantId: "action.create-task",
    category: "action",
    label: "Create Task",
    description: "Creates a task in the connected task tracker.",
    icon: ListTodo,
  },
  {
    variantId: "action.send-email",
    category: "action",
    label: "Send Email",
    description: "Sends an email to one or more recipients.",
    icon: MessageSquare,
  },

  // ── Conditions ────────────────────────────────────────────────────────
  {
    variantId: "condition.if-else",
    category: "condition",
    label: "If / Else",
    description: "Branches the flow on a true/false condition.",
    icon: GitBranch,
  },
  {
    variantId: "condition.filter",
    category: "condition",
    label: "Filter",
    description: "Lets only items matching all rules continue downstream.",
    icon: Filter,
  },
];

export const CATEGORY_ORDER: BlockCategory[] = ["trigger", "action", "condition"];

/** Look up a variant by id. Falls back to `null` for unknown ids. */
export function getVariant(variantId: string): UiBlockVariant | null {
  return (
    BLOCK_REGISTRY.find((variant) => variant.variantId === variantId) ?? null
  );
}

/** Variants grouped by category, in canonical category order. */
export function getVariantsByCategory(): Record<BlockCategory, UiBlockVariant[]> {
  const grouped: Record<BlockCategory, UiBlockVariant[]> = {
    trigger: [],
    action: [],
    condition: [],
  };
  for (const variant of BLOCK_REGISTRY) {
    grouped[variant.category].push(variant);
  }
  return grouped;
}
