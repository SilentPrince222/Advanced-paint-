"use client";

import { type DragEvent } from "react";
import { Boxes, MousePointerClick } from "lucide-react";
import { useFlowStore } from "@/lib/flow-store";
import type { BlockCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PaletteItem {
  category: BlockCategory;
  label: string;
  description: string;
}

/**
 * Phase 1 palette: a single generic block. Phase 2 will expand this into the
 * three categories with sample variants (Email Received, Send Slack, etc.).
 */
const PALETTE_ITEMS: PaletteItem[] = [
  {
    category: "action",
    label: "Block",
    description: "Drag onto the canvas, or click to add at a random spot.",
  },
];

export function NodePalette() {
  const addNode = useFlowStore((state) => state.addNode);
  const nodeCount = useFlowStore((state) => state.nodes.length);

  const handleDragStart = (
    event: DragEvent<HTMLDivElement>,
    item: PaletteItem,
  ) => {
    event.dataTransfer.setData(
      "application/automation-builder-block",
      JSON.stringify(item),
    );
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Blocks</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag a block onto the canvas or click to drop it.
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {PALETTE_ITEMS.map((item) => (
          <div
            key={item.category}
            draggable
            onDragStart={(event) => handleDragStart(event, item)}
            onClick={() =>
              addNode({ category: item.category, label: item.label })
            }
            tabIndex={0}
            role="button"
            className={cn(
              "group flex cursor-grab select-none flex-col gap-1 rounded-lg border border-sidebar-border bg-card p-3 text-card-foreground shadow-sm transition",
              "hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{item.label}</span>
              <MousePointerClick className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </div>
            <span className="text-xs text-muted-foreground">
              {item.description}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-sidebar-foreground">{nodeCount}</span>{" "}
        block{nodeCount === 1 ? "" : "s"} on canvas
      </div>
    </aside>
  );
}
