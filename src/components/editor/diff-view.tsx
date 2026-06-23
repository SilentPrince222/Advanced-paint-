"use client";

import { useEffect, useState } from "react";
import { diffFlow } from "@/lib/flow-client";
import type { GraphDiff, FieldChange } from "@/lib/contract";

interface DiffViewProps {
  flowId: string;
  from: string;
  to: string;
  onClose?: () => void;
}

function fmt(v: unknown): string {
  if (v === undefined) return "∅";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function FieldChangeRow({ fc }: { fc: FieldChange }) {
  return (
    <div className="flex gap-1 text-[10px]">
      <span className="font-mono text-muted-foreground">{fc.field}:</span>
      <span className="text-red-600 line-through">{fmt(fc.before)}</span>
      <span className="text-muted-foreground">→</span>
      <span className="text-green-600">{fmt(fc.after)}</span>
    </div>
  );
}

export function DiffView({ flowId, from, to, onClose }: DiffViewProps) {
  const [diff, setDiff] = useState<GraphDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive loading: neither result nor error arrived yet for the current (flowId,from,to)
  const loading = diff === null && error === null;

  useEffect(() => {
    let live = true;
    diffFlow(flowId, from, to)
      .then((d) => { if (live) { setError(null); setDiff(d); } })
      .catch((e: unknown) => { if (live) { setDiff(null); setError(String(e)); } });
    return () => {
      live = false;
      // Reset for next invocation so loading shows while the new fetch is in flight
      setDiff(null);
      setError(null);
    };
  }, [flowId, from, to]);

  const isEmpty =
    diff &&
    diff.nodes.added.length === 0 &&
    diff.nodes.removed.length === 0 &&
    diff.nodes.modified.length === 0 &&
    diff.edges.added.length === 0 &&
    diff.edges.removed.length === 0 &&
    diff.edges.modified.length === 0;

  return (
    <div className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <p className="text-xs font-semibold tracking-tight text-foreground">Diff</p>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="Close diff"
          >
            ✕
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <p className="text-[11px] text-muted-foreground">Loading…</p>
        )}
        {error && (
          <p className="text-[11px] text-destructive">{error}</p>
        )}
        {diff && isEmpty && (
          <p className="text-[11px] text-muted-foreground">No changes.</p>
        )}
        {diff && !isEmpty && (
          <div className="flex flex-col gap-4">
            {/* Nodes */}
            {(diff.nodes.added.length > 0 ||
              diff.nodes.removed.length > 0 ||
              diff.nodes.modified.length > 0) && (
              <section>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Nodes
                </p>
                <div className="flex flex-col gap-1.5">
                  {diff.nodes.added.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-md border border-border bg-green-50 px-2 py-1"
                    >
                      <p className="text-[11px] font-medium text-green-600">
                        + {n.id} ({n.type})
                      </p>
                    </div>
                  ))}
                  {diff.nodes.removed.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-md border border-border bg-red-50 px-2 py-1"
                    >
                      <p className="text-[11px] font-medium text-red-600">
                        − {n.id} ({n.type})
                      </p>
                    </div>
                  ))}
                  {diff.nodes.modified.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-md border border-border bg-amber-50 px-2 py-1"
                    >
                      <p className="mb-1 text-[11px] font-medium text-amber-600">
                        ~ {m.id} ({m.type})
                      </p>
                      {m.fieldChanges.map((fc) => (
                        <FieldChangeRow key={fc.field} fc={fc} />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Edges */}
            {(diff.edges.added.length > 0 ||
              diff.edges.removed.length > 0 ||
              diff.edges.modified.length > 0) && (
              <section>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Edges
                </p>
                <div className="flex flex-col gap-1.5">
                  {diff.edges.added.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-md border border-border bg-green-50 px-2 py-1"
                    >
                      <p className="text-[11px] font-medium text-green-600">
                        + {e.id} ({e.fromNodeId} → {e.toNodeId})
                      </p>
                    </div>
                  ))}
                  {diff.edges.removed.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-md border border-border bg-red-50 px-2 py-1"
                    >
                      <p className="text-[11px] font-medium text-red-600">
                        − {e.id} ({e.fromNodeId} → {e.toNodeId})
                      </p>
                    </div>
                  ))}
                  {diff.edges.modified.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-md border border-border bg-amber-50 px-2 py-1"
                    >
                      <p className="mb-1 text-[11px] font-medium text-amber-600">
                        ~ {m.id}
                      </p>
                      {m.fieldChanges.map((fc) => (
                        <FieldChangeRow key={fc.field} fc={fc} />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
