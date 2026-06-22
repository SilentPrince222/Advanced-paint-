import type {
  BaseNodeData,
  FlowEdge,
  FlowNode,
  GraphDocument,
  GraphEdge,
  GraphNode,
  NodeView,
} from "./types";

/**
 * Pure (de)serialization between the React Flow canvas representation and the
 * two-layer Data Contract (SPEC §2.1).
 *
 * Extracted from the Zustand store so the logic is independently testable and
 * reusable — Phase 4 (version history) and Phase 5 (diff) lean on these
 * heavily without touching React / the store.
 *
 * Nothing here touches store state; the store wires these in thin wrappers.
 */

/** Canvas → Data Contract. Strips React Flow's transient node metadata. */
export function toGraphDocument(
  nodes: FlowNode[],
  edges: FlowEdge[],
): GraphDocument {
  const logicNodes: GraphNode[] = nodes.map((node) => {
    const { id, data } = node;
    const { type, params, credentialRef, isDraftSafe } = data;
    const logic: GraphNode = {
      id,
      type,
      params: { ...params },
      isDraftSafe,
    };
    if (credentialRef !== undefined) logic.credentialRef = credentialRef;
    return logic;
  });

  const logicEdges: GraphEdge[] = edges.map((edge) => {
    const logic: GraphEdge = {
      id: edge.id,
      fromNodeId: edge.source,
      toNodeId: edge.target,
    };
    const condition = edge.data?.condition;
    if (condition !== undefined) logic.condition = condition;
    return logic;
  });

  // Emit required width/height from RF node geometry (default 160×80 per SPEC
  // DDL §3). color is not tracked yet — omit it.
  const views: NodeView[] = nodes.map((node) => ({
    nodeId: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? 160,
    height: node.height ?? 80,
  }));

  return { nodes: logicNodes, edges: logicEdges, views };
}

/**
 * Data Contract → canvas. Applies two defensive normalizations:
 *  - missing `isDraftSafe` coerces to the SPEC §6.0 default (true)
 *  - orphan edges (endpoint not in `document.nodes`) are dropped
 *
 * Returns the {nodes, edges} to put on the canvas; the store applies them.
 */
export function fromGraphDocument(document: GraphDocument): {
  nodes: FlowNode[];
  edges: FlowEdge[];
} {
  const viewByNodeId = new Map(document.views.map((v) => [v.nodeId, v]));

  const nodes: FlowNode[] = document.nodes.map((logic) => {
    const view = viewByNodeId.get(logic.id);
    const isDraftSafe = logic.isDraftSafe ?? true;
    return {
      id: logic.id,
      type: "base",
      position: { x: view?.x ?? 0, y: view?.y ?? 0 },
      // Propagate width/height from the view so the round-trip restores
      // geometry (default 160×80 per SPEC DDL §3).
      width: view?.width ?? 160,
      height: view?.height ?? 80,
      data: { ...logic, isDraftSafe } as BaseNodeData,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = document.edges
    .filter(
      (logic) => nodeIds.has(logic.fromNodeId) && nodeIds.has(logic.toNodeId),
    )
    .map((logic) => ({
      id: logic.id,
      source: logic.fromNodeId,
      target: logic.toNodeId,
      type: "smoothstep",
      animated: true,
      data: logic.condition !== undefined ? { condition: logic.condition } : {},
    }));

  return { nodes, edges };
}
