/**
 * Parse + validate the drag payload sent from the NodePalette
 * (`application/automation-builder-block`).
 *
 * The drop is an untrusted boundary: `event.dataTransfer.getData()` returns a
 * string, and `JSON.parse` can yield any shape. A malformed payload must NOT
 * reach the store — `addNode({ type: 123 })` would later crash the node
 * renderer, because `categoryOf(123)` calls `.split()` on a number.
 *
 * Returns the validated `{ type }` on success, or `null` for any malformed /
 * empty / non-string `type`.
 */
export interface DropPayload {
  type: string;
}

export function parseDropPayload(raw: string | null | undefined): DropPayload | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object") return null;

  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || type.length === 0) return null;

  return { type };
}
