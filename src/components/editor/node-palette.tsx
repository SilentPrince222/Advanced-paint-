"use client";

import { type DragEvent } from "react";
import { Boxes } from "lucide-react";
import { useFlowStore } from "@/lib/flow-store";
import {
  CATEGORY_ORDER,
  CATEGORY_STYLES,
  getVariantsByCategory,
  type UiBlockVariant,
} from "@/lib/block-registry";
import type { BlockCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PaletteDragPayload {
  category: BlockCategory;
  variantId: string;
  label: string;
}

export function NodePalette() {
  const addNode = useFlowStore((state) => state.addNode);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const grouped = getVariantsByCategory();

  const handleDragStart = (
    event: DragEvent<HTMLDivElement>,
    variant: UiBlockVariant,
  ) => {
    const payload: PaletteDragPayload = {
      category: variant.category,
      variantId: variant.variantId,
      label: variant.label,
    };
    event.dataTransfer.setData(
      "application/automation-builder-block",
      JSON.stringify(payload),
    );
    event.dataTransfer.effectAllowed = "move";
  };

  const handleAdd = (variant: UiBlockVariant) => {
    addNode({
      category: variant.category,
      variantId: variant.variantId,
      label: variant.label,
    });
  };

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Blocks</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag a block onto the canvas, or click to drop it.
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {CATEGORY_ORDER.map((category) => {
          const variants = grouped[category];
          const style = CATEGORY_STYLES[category];
          if (variants.length === 0) return null;
          return (
            <section key={category} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className={cn("h-2 w-2 rounded-full", style.dot)} />
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {style.label}
                </h3>
              </div>

              <div className="space-y-2">
                {variants.map((variant) => {
                  const Icon = variant.icon;
                  return (
                    <div
                      key={variant.variantId}
                      draggable
                      onDragStart={(event) => handleDragStart(event, variant)}
                      onClick={() => handleAdd(variant)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleAdd(variant);
                        }
                      }}
                      className={cn(
                        "group flex cursor-grab select-none items-start gap-2.5 rounded-lg border border-sidebar-border bg-card p-2.5 text-card-foreground shadow-sm transition",
                        "hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                          style.chip,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-tight">
                          {variant.label}
                        </span>
                        {variant.description ? (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                            {variant.description}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-sidebar-foreground">{nodeCount}</span>{" "}
        block{nodeCount === 1 ? "" : "s"} on canvas · select + Delete to remove
      </div>
    </aside>
  );
}
