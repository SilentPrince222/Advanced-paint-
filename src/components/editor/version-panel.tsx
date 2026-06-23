"use client";

import { useEffect, useState } from "react";
import { useFlowStore } from "@/lib/flow-store";
import { Button } from "@/components/ui/button";
import {
  commitFlow,
  createBranch,
  listBranches,
  listCommits,
  rollbackFlow,
  saveFlowToServer,
  DEMO_FLOW_ID,
} from "@/lib/flow-client";
import type { Branch, CommitMeta } from "@/lib/contract";
import { DiffView } from "@/components/editor/diff-view";
import { ExecLogViewer } from "@/components/editor/exec-log-viewer";

export function VersionPanel() {
  const currentBranchId = useFlowStore((s) => s.currentBranchId);
  const setCurrentBranchId = useFlowStore((s) => s.setCurrentBranchId);
  const bumpExecLog = useFlowStore((s) => s.bumpExecLog);

  const [commits, setCommits] = useState<CommitMeta[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchName, setBranchName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffFor, setDiffFor] = useState<CommitMeta | null>(null);

  const refresh = async () => {
    try {
      const [commitList, branchList] = await Promise.all([
        listCommits(DEMO_FLOW_ID),
        listBranches(DEMO_FLOW_ID),
      ]);
      setCommits(commitList);
      setBranches(branchList);
    } catch {
      // non-fatal — lists stay stale
    }
  };

  useEffect(() => {
    let live = true;
    Promise.all([listCommits(DEMO_FLOW_ID), listBranches(DEMO_FLOW_ID)])
      .then(([commitList, branchList]) => {
        if (!live) return;
        setCommits(commitList);
        setBranches(branchList);
      })
      .catch(() => { /* non-fatal */ });
    return () => { live = false; };
  }, []);

  // Fork source = the ACTIVE branch's head commit (BLOCKER 1 fix). commits[0]
  // is flow-scoped (wrong-graph risk); headCommitId is per-branch correct.
  // currentBranchId undefined ≡ main (store/store-route semantics), so resolve
  // the effective id the same way the selector's `value` does before the lookup.
  const mainBranch = branches.find((b) => b.name === "main");
  const effectiveBranchId = currentBranchId ?? mainBranch?.id;
  const headCommitId =
    branches.find((b) => b.id === effectiveBranchId)?.headCommitId ?? null;

  const onCommit = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc = useFlowStore.getState().toGraphDocument();
      await saveFlowToServer(DEMO_FLOW_ID, doc, currentBranchId);
      await commitFlow(DEMO_FLOW_ID, note, currentBranchId);
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
      const res = await rollbackFlow(DEMO_FLOW_ID, commitId, currentBranchId);
      useFlowStore.getState().fromGraphDocument(res.doc);
      await refresh();
      bumpExecLog();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCreateBranch = async () => {
    if (!branchName || headCommitId == null) return;
    setBusy(true);
    setError(null);
    try {
      const branch = await createBranch(DEMO_FLOW_ID, branchName, headCommitId);
      setBranchName("");
      await refresh();
      setCurrentBranchId(branch.id);
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
        <select
          className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={currentBranchId ?? mainBranch?.id ?? ""}
          onChange={(e) => setCurrentBranchId(e.target.value)}
          disabled={!branches.length}
        >
          {!branches.length && <option value="">Loading…</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

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

      <div className="flex flex-col gap-1.5">
        <input
          className="rounded-md border border-border bg-muted px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Branch name…"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          disabled={busy}
          maxLength={80}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={onCreateBranch}
          disabled={headCommitId == null || !branchName || busy}
        >
          Branch
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

      <ExecLogViewer />
    </aside>
  );
}
