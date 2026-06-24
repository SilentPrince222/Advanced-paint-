"use client";

import { useEffect, useState } from "react";
import { Lock, AlertCircle } from "lucide-react";
import { useFlowStore } from "@/lib/flow-store";
import { listExecLog } from "@/lib/flow-client";
import type { ExecLogEntry } from "@/lib/contract";

export function ExecLogViewer({ flowId }: { flowId: string }) {
  const execLogNonce = useFlowStore((s) => s.execLogNonce);
  const [entries, setEntries] = useState<ExecLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let live = true;
    listExecLog(flowId)
      .then((e) => {
        if (live) {
          setEntries(e);
          setError(null);
        }
      })
      .catch((err) => {
        if (live) setError(String(err));
      });
    return () => {
      live = false;
    };
    // persistRun COMMIT completes before run/route.ts writes the response,
    // so the post-bumpExecLog re-fetch is guaranteed to see committed rows (no race).
  }, [execLogNonce, flowId]);

  if (collapsed) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted/70"
          onClick={() => setCollapsed(false)}
        >
          <Lock className="h-3 w-3 text-muted-foreground" />
          <span>Execution log</span>
          <span className="text-muted-foreground">({entries.length})</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold">Execution log</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {entries.length}
          </span>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed(true)}
        >
          Collapse
        </button>
      </div>

      <div className="rounded-md border border-border bg-muted/50 px-2 py-1">
        <p className="text-[10px] text-muted-foreground">
          trigger-enforced append-only (REVOKE backstop on IAM role)
        </p>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5">
          <AlertCircle className="h-3 w-3 text-destructive" />
          <span className="text-xs text-destructive">{error}</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-3">
          <p className="text-xs text-muted-foreground text-center">
            No executions yet — Run the flow.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((e) => (
            <div
              key={e.id}
              className="rounded-md border border-border bg-background px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      e.status === "success"
                        ? "bg-green-500/20 text-green-700 dark:text-green-400"
                        : "bg-red-500/20 text-red-700 dark:text-red-400"
                    }`}
                  >
                    {e.status}
                  </span>
                  {e.response.mock === true && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      MOCK
                    </span>
                  )}
                  <span className="text-xs font-medium">{e.actionType}</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>node: {e.nodeId}</span>
                <span>·</span>
                <span className="truncate">
                  {typeof e.response.chargeId === "string"
                    ? e.response.chargeId
                    : typeof e.response.id === "string"
                      ? e.response.id
                      : JSON.stringify(e.response).slice(0, 30)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
