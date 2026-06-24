"use client";

import { useEffect, useState } from "react";
import { Plus, Workflow } from "lucide-react";
import { listFlows, createNewFlow, type FlowSummary } from "@/lib/flow-client";
import { formatRelativeDate } from "@/lib/format-date";

interface DashboardProps {
  onSelectFlow: (id: string) => void;
}

export function Dashboard({ onSelectFlow }: DashboardProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; flows: FlowSummary[] }
  >({ status: "loading" });
  const [creating, setCreating] = useState(false);

  const loadFlows = () => {
    setState({ status: "loading" });
    listFlows()
      .then((flows) => setState({ status: "ready", flows }))
      .catch((e) => setState({ status: "error", message: String(e) }));
  };

  useEffect(loadFlows, []); // eslint-disable-line react-hooks/set-state-in-effect

  const handleCreate = async () => {
    setCreating(true);
    try {
      const flow = await createNewFlow("Untitled flow");
      onSelectFlow(flow.id);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <Workflow className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold tracking-tight">
            Visual Automation Builder
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <h2 className="mb-6 text-xl font-semibold">My Flows</h2>

        {state.status === "error" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-destructive">{state.message}</p>
            <button
              onClick={loadFlows}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === "loading" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        )}

        {state.status === "ready" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-8 w-8 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                New flow
              </span>
            </button>

            {state.flows.map((flow) => (
              <button
                key={flow.id}
                onClick={() => onSelectFlow(flow.id)}
                className="flex h-28 flex-col justify-between rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <span className="truncate text-sm font-medium">
                  {flow.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeDate(flow.updatedAt)}
                </span>
              </button>
            ))}

            {state.flows.length === 0 && (
              <p className="col-span-full pt-2 text-center text-sm text-muted-foreground">
                Start your first flow
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
