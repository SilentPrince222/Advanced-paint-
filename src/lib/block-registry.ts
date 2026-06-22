import {
  Clock,
  GitBranch,
  CreditCard,
  Send,
  Webhook,
  type LucideIcon,
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
 * Per-category visual accent — single source of truth shared by the node
 * renderer and the palette.
 */
export interface CategoryStyle {
  /** chip / icon background + text */
  chip: string;
  /** solid dot color */
  dot: string;
  /** ring color on the node card */
  ring: string;
  /** handle (source/target) color */
  handle: string;
  /** human label */
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

export const CATEGORY_ORDER: BlockCategory[] = ["trigger", "action", "condition"];

/**
 * The canonical block registry — the 5 demo-scope types from SPEC §2.5.
 *
 *   trigger.webhook       {}                                   // payload from inbound request
 *   trigger.schedule      { cron }
 *   condition.if          { expression }                       // e.g. "plan == 'pro'"
 *   action.stripe.charge  { amount, currency }                 // credential via credentialRef
 *   action.slack.post     { channel, message }                 // credential via credentialRef
 *
 * `fields` is the config schema that drives the generic SidePanel form
 * (Phase 3) — adding a node type never touches SidePanel code.
 */
export const BLOCK_REGISTRY: UiBlockVariant[] = [
  // ── Triggers ──────────────────────────────────────────────────────────
  {
    type: "trigger.webhook",
    category: "trigger",
    label: "Webhook",
    description: "Fires when an external service calls the webhook URL.",
    icon: Webhook,
    fields: [],
  },
  {
    type: "trigger.schedule",
    category: "trigger",
    label: "Schedule",
    description: "Fires on a cron-style schedule (e.g. `0 9 * * MON`).",
    icon: Clock,
    fields: [
      {
        key: "cron",
        label: "Cron expression",
        type: "text",
        placeholder: "0 9 * * MON",
        help: "Standard 5-field cron (min hour day month weekday).",
        defaultValue: "0 9 * * MON",
      },
    ],
  },

  // ── Conditions ────────────────────────────────────────────────────────
  {
    type: "condition.if",
    category: "condition",
    label: "If",
    description: "Branches the flow on a true/false expression.",
    icon: GitBranch,
    fields: [
      {
        key: "expression",
        label: "Expression",
        type: "text",
        placeholder: "plan == 'pro'",
        help: "Evaluated against the run context; follow the matching edge.",
        defaultValue: "plan == 'pro'",
      },
    ],
  },

  // ── Actions ───────────────────────────────────────────────────────────
  {
    type: "action.stripe.charge",
    category: "action",
    label: "Stripe Charge",
    description: "Creates a charge via Stripe (test mode in the demo).",
    icon: CreditCard,
    requiresCredential: true,
    fields: [
      {
        key: "amount",
        label: "Amount",
        type: "number",
        placeholder: "100",
        help: "Smallest currency unit (cents) — 100 = $1.00.",
        defaultValue: 100,
      },
      {
        key: "currency",
        label: "Currency",
        type: "select",
        defaultValue: "usd",
        options: [
          { label: "USD", value: "usd" },
          { label: "EUR", value: "eur" },
          { label: "GBP", value: "gbp" },
          { label: "KZT", value: "kzt" },
        ],
      },
    ],
  },
  {
    type: "action.slack.post",
    category: "action",
    label: "Slack Post",
    description: "Posts a message to a Slack channel.",
    icon: Send,
    requiresCredential: true,
    fields: [
      {
        key: "channel",
        label: "Channel",
        type: "text",
        placeholder: "#revenue",
        defaultValue: "#revenue",
      },
      {
        key: "message",
        label: "Message",
        type: "textarea",
        placeholder: "New charge received.",
        defaultValue: "New charge received.",
      },
    ],
  },
];

/** Look up a variant by canonical `type`. Returns null for unknown types. */
export function getVariant(type: string): UiBlockVariant | null {
  return BLOCK_REGISTRY.find((variant) => variant.type === type) ?? null;
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

/**
 * Build a node's default `params` from a variant's field schema (SPEC §2.5):
 * each field seeds `params[key]` with its `defaultValue`. Fields without a
 * default are omitted so the SidePanel can tell "unset" from "set to default".
 *
 * Lives here (not in the store) because it reads the variant/field schema —
 * it is block-variant logic, not store logic.
 */
export function defaultParamsFor(type: string): Record<string, unknown> {
  const variant = getVariant(type);
  const params: Record<string, unknown> = {};
  for (const field of variant?.fields ?? []) {
    if (field.defaultValue !== undefined) {
      params[field.key] = field.defaultValue;
    }
  }
  return params;
}
