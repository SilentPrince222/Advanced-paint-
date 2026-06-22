"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Save, Workflow } from "lucide-react";
import { useFlowStore } from "@/lib/flow-store";
import { Button } from "@/components/ui/button";
import { fetchFlow, saveFlowToServer, DEMO_FLOW_ID } from "@/lib/flow-client";
import { NodePalette } from "./node-palette";
import { FlowCanvas } from "./flow-canvas";

export function Editor() {
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const edgeCount = useFlowStore((state) => state.edges.length);
  const toDoc = useFlowStore((s) => s.toGraphDocument);
  const fromDoc = useFlowStore((s) => s.fromGraphDocument);

  const [status, setStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("loading");

  // Load on mount
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const d = await fetchFlow(DEMO_FLOW_ID);
        if (live && d) fromDoc(d);
        if (live) setStatus("idle");
      } catch {
        if (live) setStatus("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [fromDoc]);

  const onSave = async () => {
    setStatus("saving");
    try {
      await saveFlowToServer(DEMO_FLOW_ID, toDoc());
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

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
              Rung 0 · Persist
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{nodeCount}</span>{" "}
              block{nodeCount === 1 ? "" : "s"}
            </span>
            <span className="text-border">·</span>
            <span>
              <span className="font-medium text-foreground">{edgeCount}</span>{" "}
              connection{edgeCount === 1 ? "" : "s"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={onSave}
              disabled={status === "saving" || status === "loading"}
            >
              {status === "saving" ? (
                <Loader2 className="animate-spin" />
              ) : status === "saved" ? (
                <Check />
              ) : (
                <Save />
              )}
              {status === "saving"
                ? "Saving…"
                : status === "saved"
                  ? "Saved"
                  : "Save"}
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
