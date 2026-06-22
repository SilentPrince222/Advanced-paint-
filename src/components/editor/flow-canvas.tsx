"use client";

import { useCallback, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type DefaultEdgeOptions,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useFlowStore } from "@/lib/flow-store";
import { categoryOf, isNodeType } from "@/lib/types";
import { parseDropPayload } from "@/lib/drop-payload";
import { BaseNode } from "./base-node";

const nodeTypes: NodeTypes = { base: BaseNode };

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: "smoothstep",
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 1.75 },
};

function FlowCanvasInner() {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const onNodesChange = useFlowStore((state) => state.onNodesChange);
  const onEdgesChange = useFlowStore((state) => state.onEdgesChange);
  const onConnect = useFlowStore((state) => state.onConnect);
  const addNode = useFlowStore((state) => state.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(
        "application/automation-builder-block",
      );

      // Untrusted boundary: validate before touching the store. A malformed
      // payload (`{"type":123}`) would otherwise store a non-string type and
      // crash the node renderer in categoryOf().
      const payload = parseDropPayload(raw);
      if (!payload) return;
      if (!isNodeType(payload.type)) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode({ type: payload.type, position });
    },
    [addNode, screenToFlowPosition],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      fitView
      deleteKeyCode={["Backspace", "Delete"]}
      multiSelectionKeyCode={["Meta", "Shift"]}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={2}
        className="text-border"
      />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const type = (node.data as { type?: string } | null)?.type ?? "";
          switch (categoryOf(type)) {
            case "trigger":
              return "#10b981";
            case "condition":
              return "#f59e0b";
            default:
              return "#3b82f6";
          }
        }}
        className="!bg-muted"
        maskColor="rgb(0 0 0 / 0.05)"
      />
      <Controls className="!shadow-md" />
    </ReactFlow>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
