"use client";

import { useCallback, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useFlowStore } from "@/lib/flow-store";
import type { BlockCategory } from "@/lib/types";
import { BaseNode } from "./base-node";

const nodeTypes: NodeTypes = { base: BaseNode };

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
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      fitView
      deleteKeyCode={null}
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
