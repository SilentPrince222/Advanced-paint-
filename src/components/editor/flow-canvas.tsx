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
import type { BlockCategory } from "@/lib/types";
import { BaseNode } from "./base-node";

const nodeTypes: NodeTypes = { base: BaseNode };

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: "smoothstep",
  animated: true,
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 1.75 },
};

interface DroppedPayload {
  category?: BlockCategory;
  label?: string;
  variantId?: string;
}

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
      if (!raw) return;

      let payload: DroppedPayload;
      try {
        payload = JSON.parse(raw) as DroppedPayload;
      } catch {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode({
        category: payload.category,
        label: payload.label,
        variantId: payload.variantId,
        position,
      });
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
          const category = (node.data as { category?: BlockCategory } | null)
            ?.category;
          switch (category) {
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
