"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { BaseNodeData, BlockCategory } from "@/lib/types";

type BaseNodeType = Node<BaseNodeData, "base">;

const CATEGORY_STYLES: Record<
  BlockCategory,
  { ring: string; badge: string; dot: string; label: string }
> = {
  trigger: {
    ring: "ring-emerald-500/40",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    label: "Trigger",
  },
  action: {
    ring: "ring-blue-500/40",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
    label: "Action",
  },
  condition: {
    ring: "ring-amber-500/40",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    label: "Condition",
  },
};

function BaseNodeComponent({ data, selected }: NodeProps<BaseNodeType>) {
  const category = (data.category ?? "action") as BlockCategory;
  const style = CATEGORY_STYLES[category];

  return (
    <div
      className={cn(
        "min-w-44 max-w-56 rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        "px-4 py-3 ring-1 transition-shadow",
        style.ring,
        selected && "ring-2 ring-offset-1 ring-offset-background",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground/60"
      />

      <div className="mb-1 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", style.dot)} />
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            style.badge,
          )}
        >
          {style.label}
        </span>
      </div>

      <div className="text-sm font-medium leading-tight">{data.label}</div>
      {data.variantId && data.variantId !== "generic" ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {data.variantId}
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground/60"
      />
    </div>
  );
}

export const BaseNode = memo(BaseNodeComponent);
