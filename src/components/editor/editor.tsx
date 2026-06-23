"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Play, Save, Workflow, X } from "lucide-react";
import { useFlowStore } from "@/lib/flow-store";
import { Button } from "@/components/ui/button";
import {
  fetchFlow,
  saveFlowToServer,
  runFlow,
  type RunResult,
  DEMO_FLOW_ID,
} from "@/lib/flow-client";
import { NodePalette } from "./node-palette";
import { FlowCanvas } from "./flow-canvas";
import { VersionPanel } from "./version-panel";

export function Editor() {
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const edgeCount = useFlowStore((state) => state.edges.length);
  const toDoc = useFlowStore((s) => s.toGraphDocument);
  const fromDoc = useFlowStore((s) => s.fromGraphDocument);

  const [status, setStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("loading");

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

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

  // B13: a "saved" badge must not survive an edit. Subscribe to the store and
  // clear it on any canvas mutation — the lint-blessed "setState inside a store
  // subscription callback" pattern, not a synchronous setState-in-effect.
  useEffect(() => {
    return useFlowStore.subscribe(() => {
      setStatus((s) => (s === "saved" ? "idle" : s));
    });
  }, []);

  const onSave = async () => {
    setStatus("saving");
    try {
      await saveFlowToServer(DEMO_FLOW_ID, toDoc());
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const onRun = async () => {
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      await saveFlowToServer(DEMO_FLOW_ID, toDoc());
      setRunResult(await runFlow(DEMO_FLOW_ID));
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(false);
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
              Rung 1 · Run
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
              onClick={onRun}
              disabled={running || status === "saving" || status === "loading"}
            >
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? "Running…" : "Run"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onSave}
              disabled={running || status === "saving" || status === "loading"}
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

          {(runResult || runError) && (
            <div className="absolute bottom-4 left-4 z-10 w-80 max-w-[calc(100%-2rem)] rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-xs font-semibold tracking-tight">
                  Run result
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => {
                    setRunResult(null);
                    setRunError(null);
                  }}
                  aria-label="Dismiss run result"
                >
                  <X />
                </Button>
              </div>

              <div className="px-3 py-2 text-xs">
                {runError ? (
                  <p className="text-destructive">{runError}</p>
                ) : runResult && runResult.entries.length === 0 ? (
                  <p className="text-muted-foreground">
                    Flow ran — no actions to execute.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {runResult?.entries.map((e) => {
                      const res = e.response as {
                        mock?: boolean;
                        chargeId?: string;
                      };
                      return (
                        <li
                          key={e.id}
                          className="flex flex-wrap items-center gap-1.5"
                        >
                          <span className="font-medium text-foreground">
                            {e.actionType}
                          </span>
                          {res.mock && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Mock
                            </span>
                          )}
                          {res.chargeId && (
                            <span className="text-muted-foreground">
                              {res.chargeId}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {runResult?.commitId && (
                <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
                  commit {runResult.commitId.slice(0, 8)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <VersionPanel />
    </div>
  );
}
