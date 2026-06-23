import type {
  GraphDocument,
  GraphNode,
  GraphEdge,
  GraphDiff,
  FieldChange,
  NodeType,
} from "@/lib/contract";

/**
 * Structural equality — arrays compared as whole values (SPEC §4:313).
 * Primitives via ===; objects by key-set + recursive descent; arrays by length + elementwise.
 */
function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valueEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    a !== null && b !== null &&
    typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!valueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Flatten an object into dotted leaf-paths.
 * Arrays, primitives, null, and undefined are all leaves — never recurse into them.
 * `exclude` names are skipped at the top level.
 */
function leafPaths(
  obj: Record<string, unknown>,
  exclude: Set<string>,
  prefix = "",
): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const key of Object.keys(obj)) {
    if (exclude.has(key)) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Array.isArray(val)
    ) {
      // Plain object — recurse (no exclude after top level)
      const nested = leafPaths(val as Record<string, unknown>, new Set(), fullKey);
      for (const [k, v] of nested) {
        result.set(k, v);
      }
    } else {
      // Leaf: primitive, array, null, undefined
      result.set(fullKey, val);
    }
  }
  return result;
}

/**
 * Compute field-level changes between two node/edge objects.
 * Each side defaults to `{}` to guard against undefined params.
 * Returns changes sorted by field ascending.
 */
function diffFields(
  x: Record<string, unknown>,
  y: Record<string, unknown>,
  exclude: Set<string>,
): FieldChange[] {
  const xSafe = x ?? {};
  const ySafe = y ?? {};
  const xPaths = leafPaths(xSafe, exclude);
  const yPaths = leafPaths(ySafe, exclude);

  const allPaths = new Set([...xPaths.keys(), ...yPaths.keys()]);
  const changes: FieldChange[] = [];

  for (const path of allPaths) {
    const before = xPaths.get(path);
    const after = yPaths.get(path);
    if (!valueEqual(before, after)) {
      changes.push({ field: path, before, after });
    }
  }

  return changes.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Compute the field-level diff between two GraphDocuments.
 * Anchored on stable node/edge `id`.
 * Views are NEVER diffed (SPEC §4, contract.ts:97).
 * modified[] arrays are sorted by id ascending for determinism.
 */
export function diffGraph(a: GraphDocument, b: GraphDocument): GraphDiff {
  // Index by id
  const aN = new Map<string, GraphNode>(a.nodes.map((n) => [n.id, n]));
  const bN = new Map<string, GraphNode>(b.nodes.map((n) => [n.id, n]));
  const aE = new Map<string, GraphEdge>(a.edges.map((e) => [e.id, e]));
  const bE = new Map<string, GraphEdge>(b.edges.map((e) => [e.id, e]));

  const EXCLUDE_ID = new Set(["id"]);

  // Nodes
  const nodesAdded: GraphNode[] = b.nodes.filter((n) => !aN.has(n.id));
  const nodesRemoved: GraphNode[] = a.nodes.filter((n) => !bN.has(n.id));
  const nodesModified: { id: string; type: NodeType; fieldChanges: FieldChange[] }[] = [];

  for (const [id, an] of aN) {
    const bn = bN.get(id);
    if (!bn) continue; // removed, handled above
    const fc = diffFields(
      an as unknown as Record<string, unknown>,
      bn as unknown as Record<string, unknown>,
      EXCLUDE_ID,
    );
    if (fc.length > 0) {
      nodesModified.push({ id, type: bn.type, fieldChanges: fc });
    }
  }
  nodesModified.sort((a, b) => a.id.localeCompare(b.id));

  // Edges
  const edgesAdded: GraphEdge[] = b.edges.filter((e) => !aE.has(e.id));
  const edgesRemoved: GraphEdge[] = a.edges.filter((e) => !bE.has(e.id));
  const edgesModified: { id: string; fieldChanges: FieldChange[] }[] = [];

  for (const [id, ae] of aE) {
    const be = bE.get(id);
    if (!be) continue;
    const fc = diffFields(
      ae as unknown as Record<string, unknown>,
      be as unknown as Record<string, unknown>,
      EXCLUDE_ID,
    );
    if (fc.length > 0) {
      edgesModified.push({ id, fieldChanges: fc });
    }
  }
  edgesModified.sort((a, b) => a.id.localeCompare(b.id));

  return {
    nodes: { added: nodesAdded, removed: nodesRemoved, modified: nodesModified },
    edges: { added: edgesAdded, removed: edgesRemoved, modified: edgesModified },
  };
}
