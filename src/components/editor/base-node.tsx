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
import { Lock, Trash2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryOf, type LogicNode } from "@/lib/types";
import {
  CATEGORY_STYLES,
  getVariant,
  type UiBlockVariant,
} from "@/lib/block-registry";
import { useFlowStore } from "@/lib/flow-store";

type BaseNodeType = Node<LogicNode, "base">;

/**
 * Compact one-line summary of a node's primary param value, e.g.
 * `#revenue`, `100 usd`, `plan == 'pro'`. Driven by the variant's field
 * schema so adding a node type never touches this renderer.
 */
function paramSummary(variant: UiBlockVariant | null, params: Record<string, unknown>): string {
  if (!variant || variant.fields.length === 0) return "";
  const parts: string[] = [];
  for (const field of variant.fields.slice(0, 2)) {
    const value = params[field.key];
    if (value === undefined || value === "") continue;
    const text = field.type === "select"
      ? field.options?.find((o) => o.value === String(value))?.label ?? String(value)
      : String(value);
    parts.push(text);
  }
  return parts.join(" · ");
}

function BaseNodeComponent({ id, data, selected }: NodeProps<BaseNodeType>) {
  const type = data.type;
  const category = categoryOf(type);
  const style = CATEGORY_STYLES[category];
  const variant = getVariant(type);
  const Icon = variant?.icon ?? Workflow;
  const label = variant?.label ?? type;
  const requiresCredential = variant?.requiresCredential === true;

  const removeNode = useFlowStore((state) => state.removeNode);
  const { setNodes } = useReactFlow();

  const handleDelete = () => {
    removeNode(id);
    setNodes((nodes) => nodes.filter((node) => node.id !== id));
  };

  const summary = paramSummary(variant, data.params);

  return (
    <div
      className={cn(
        "group relative min-w-48 max-w-60 rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        "px-4 py-3 ring-1 transition-shadow",
        style.ring,
        selected && "ring-2 ring-offset-1 ring-offset-background",
      )}
    >
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
        className={cn("!h-2.5 !w-2.5 !border-2 !border-background", style.handle)}
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
        {requiresCredential && (
          <span
            title="Needs a credential (vault ref). Not draft-safe."
            className="ml-auto flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400"
          >
            <Lock className="h-2.5 w-2.5" />
            prod
          </span>
        )}
      </div>

      <div className="text-sm font-medium leading-tight">{label}</div>
      {summary ? (
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {summary}
        </div>
      ) : variant?.description ? (
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {variant.description}
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Bottom}
        className={cn("!h-2.5 !w-2.5 !border-2 !border-background", style.handle)}
      />
    </div>
  );
}

export const BaseNode = memo(BaseNodeComponent);
