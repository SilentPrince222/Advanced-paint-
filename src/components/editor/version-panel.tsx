"use client";

import { useEffect, useState } from "react";
import { useFlowStore } from "@/lib/flow-store";
import { Button } from "@/components/ui/button";
import {
  commitFlow,
  listCommits,
  rollbackFlow,
  saveFlowToServer,
  DEMO_FLOW_ID,
} from "@/lib/flow-client";
import type { CommitMeta } from "@/lib/contract";
import { DiffView } from "@/components/editor/diff-view";

export function VersionPanel() {
  const [commits, setCommits] = useState<CommitMeta[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<CommitMeta | null>(null);

  const refresh = async () => {
    try {
      const list = await listCommits(DEMO_FLOW_ID);
      setCommits(list);
    } catch {
      // non-fatal — list stays stale
    }
  };

  useEffect(() => {
    let live = true;
    listCommits(DEMO_FLOW_ID)
      .then((list) => { if (live) setCommits(list); })
      .catch(() => { /* non-fatal */ });
    return () => { live = false; };
  }, []);

  const onCommit = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = useFlowStore.getState().toGraphDocument();
      await saveFlowToServer(DEMO_FLOW_ID, doc);
      await commitFlow(DEMO_FLOW_ID, note);
      setNote("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRollback = async (commitId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await rollbackFlow(DEMO_FLOW_ID, commitId);
      useFlowStore.getState().fromGraphDocument(res.doc);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex w-56 flex-shrink-0 flex-col gap-3 border-l border-border bg-background p-3">
      <p className="text-xs font-semibold tracking-tight text-foreground">
        Version history
      </p>

      <div className="flex flex-col gap-1.5">
        <input
          className="rounded-md border border-border bg-muted px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Commit note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          maxLength={280}
        />
        <Button size="sm" onClick={onCommit} disabled={busy}>
          Commit
        </Button>
      </div>

      {error && (
        <p className="break-words text-[10px] text-destructive">{error}</p>
      )}

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {commits.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No commits yet.</p>
        )}
        {commits.map((c) => (
          <div
            key={c.id}
            className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5"
          >
            <p className="truncate text-[11px] font-medium text-foreground">
              {c.authorNote || "(no note)"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {c.id.slice(0, 8)}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRollback(c.id)}
              disabled={busy}
            >
              Rollback
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={c.parentId == null || busy}
              onClick={() => {
                if (c.parentId) setDiffFor(c);
              }}
            >
              Diff
            </Button>
          </div>
        ))}
      </div>

      {diffFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg">
            <DiffView
              flowId={DEMO_FLOW_ID}
              from={diffFor.parentId!}
              to={diffFor.id}
              onClose={() => setDiffFor(null)}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
