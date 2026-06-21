"use client";

import { Workflow } from "lucide-react";
import { useFlowStore } from "@/lib/flow-store";
import { Button } from "@/components/ui/button";
import { NodePalette } from "./node-palette";
import { FlowCanvas } from "./flow-canvas";

export function Editor() {
  const addNode = useFlowStore((state) => state.addNode);
  const nodeCount = useFlowStore((state) => state.nodes.length);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <NodePalette />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold tracking-tight">
              Visual Automation Builder
            </h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Phase 1 · Canvas
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {nodeCount} block{nodeCount === 1 ? "" : "s"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => addNode({ category: "action", label: "Block" })}
            >
              Add block
            </Button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <FlowCanvas />
        </div>
      </div>
    </div>
  );
}
