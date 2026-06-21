"use client";

import { memo } from "react";
import {
  Handle,
  NodeToolbar,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Trash2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BaseNodeData, BlockCategory } from "@/lib/types";
import { CATEGORY_STYLES, getVariant } from "@/lib/block-registry";
import { useFlowStore } from "@/lib/flow-store";

type BaseNodeType = Node<BaseNodeData, "base">;

function BaseNodeComponent({ id, data, selected }: NodeProps<BaseNodeType>) {
  const category = (data.category ?? "action") as BlockCategory;
  const style = CATEGORY_STYLES[category];
  const variant = data.variantId ? getVariant(data.variantId) : null;
  const Icon = variant?.icon ?? Workflow;

  const removeNode = useFlowStore((state) => state.removeNode);
  const { setNodes } = useReactFlow();

  const handleDelete = () => {
    // Remove via the store (also drops connected edges) and clear any
    // lingering React Flow selection so the deleted node isn't tracked.
    removeNode(id);
    setNodes((nodes) => nodes.filter((node) => node.id !== id));
  };

  return (
    <div
      className={cn(
        "group relative min-w-48 max-w-60 rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        "px-4 py-3 ring-1 transition-shadow",
        style.ring,
        selected && "ring-2 ring-offset-1 ring-offset-background",
      )}
    >
      {/* Hover toolbar with delete */}
      <NodeToolbar
        isVisible
        offset={8}
        position={Position.Top}
        className="flex gap-1"
      >
        <button
          type="button"
          onClick={handleDelete}
          aria-label="Delete block"
          className={cn(
            "flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1",
            "text-xs font-medium text-muted-foreground shadow-sm",
            "transition hover:border-destructive/40 hover:text-destructive",
          )}
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </NodeToolbar>

      <Handle
        type="target"
        position={Position.Top}
        className={cn(
          "!h-2.5 !w-2.5 !border-2 !border-background",
          style.handle,
        )}
      />

      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md",
            style.chip,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            style.chip,
          )}
        >
          {style.label}
        </span>
      </div>

      <div className="text-sm font-medium leading-tight">{data.label}</div>
      {variant?.description ? (
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {variant.description}
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          "!h-2.5 !w-2.5 !border-2 !border-background",
          style.handle,
        )}
      />
    </div>
  );
}

export const BaseNode = memo(BaseNodeComponent);
