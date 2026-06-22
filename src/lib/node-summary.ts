import type { UiBlockVariant } from "./block-registry";

/**
 * Pure presentation helpers for nodes. Kept out of the React component so
 * they're testable and reusable — the Phase 3 SidePanel renders the same
 * summary, and Phase 5 diff view summarizes changed params.
 */

/**
 * Compact one-line summary of a node's primary param values, e.g.
 * `#revenue`, `100 usd`, `plan == 'pro'`. Driven by the variant's field
 * schema so adding a node type never touches this code.
 *
 * Shows the first two non-empty fields. For `select` fields the option's
 * human label is shown (falling back to the raw value) so `currency: "usd"`
 * renders as `USD`.
 */
export function paramSummary(
  variant: UiBlockVariant | null,
  params: Record<string, unknown>,
): string {
  if (!variant || variant.fields.length === 0) return "";
  const parts: string[] = [];
  for (const field of variant.fields.slice(0, 2)) {
    const value = params[field.key];
    if (value === undefined || value === "") continue;
    const text =
      field.type === "select"
        ? field.options?.find((o) => o.value === String(value))?.label ??
          String(value)
        : String(value);
    parts.push(text);
  }
  return parts.join(" · ");
}
