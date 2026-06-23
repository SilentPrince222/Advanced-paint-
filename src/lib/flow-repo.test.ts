import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import {
  saveFlow,
  loadFlow,
  commitFlow,
  listCommits,
  rollbackToCommit,
  loadCommitSnapshot,
  createBranch,
  branchExists,
  persistRun,
} from "./flow-repo";
import type { GraphDocument } from "@/lib/contract";
import { randomUUID } from "node:crypto";

// Skips automatically when DATABASE_URL is absent — keeps `npm run test` green
// at 46 (the existing baseline) with no DB available.
describe.skipIf(!process.env.DATABASE_URL)("flow-repo round-trip", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(() => pool.end());

  it("saves and loads a 2-node/1-edge/2-view doc unchanged", async () => {
    const doc: GraphDocument = {
      nodes: [
        {
          id: "n1",
          type: "trigger.schedule",
          params: { cron: "0 * * * *" },
          isDraftSafe: true,
        },
        {
          id: "n2",
          type: "action.slack.post",
          params: { channel: "#test", message: "hello" },
          isDraftSafe: true,
        },
      ],
      edges: [
        {
          id: "e1",
          fromNodeId: "n1",
          toNodeId: "n2",
        },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 400, y: 200, width: 160, height: 80 },
      ],
    };

    await saveFlow(pool, "test-rung0", doc);
    const loaded = await loadFlow(pool, "test-rung0");

    expect(loaded).toEqual(doc);
  });
});

// §8 fixture-based docs: amount 100 vs 90 — mirrors e2e-rung2 fixture
const docA: GraphDocument = {
  nodes: [
    { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
    { id: "n2", type: "condition.if", params: { expression: "plan == 'pro'" }, isDraftSafe: true },
    { id: "n3", type: "action.stripe.charge", params: { amount: 100, currency: "usd" }, isDraftSafe: false },
    { id: "n4", type: "action.slack.post", params: { channel: "#revenue", message: "New charge" }, isDraftSafe: true },
  ],
  edges: [
    { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
    { id: "e2", fromNodeId: "n2", toNodeId: "n3", condition: "true" },
    { id: "e3", fromNodeId: "n3", toNodeId: "n4" },
  ],
  views: [
    { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
    { nodeId: "n2", x: 340, y: 200, width: 160, height: 80 },
    { nodeId: "n3", x: 580, y: 200, width: 160, height: 80 },
    { nodeId: "n4", x: 820, y: 200, width: 160, height: 80 },
  ],
};

const docB: GraphDocument = {
  ...docA,
  nodes: docA.nodes.map((n) =>
    n.id === "n3"
      ? { ...n, params: { amount: 90, currency: "usd" } }
      : n,
  ),
};

describe.skipIf(!process.env.DATABASE_URL)("commit history + rollback", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const flowId = `test-rung2-${Date.now()}`;

  afterAll(() => pool.end());

  it("commitFlow, listCommits, rollbackToCommit full cycle", async () => {
    // Save docA and commit it
    await saveFlow(pool, flowId, docA);
    const cA = randomUUID();
    const rA = await commitFlow(pool, flowId, cA, "v1 amount 100");
    expect(rA.ok).toBe(true);
    if (!rA.ok) throw new Error("unreachable");
    expect(rA.commit.id).toBe(cA);
    expect(rA.commit.authorNote).toBe("v1 amount 100");
    expect(rA.commit.parentId).toBeNull(); // first commit

    // Assert amount is the NUMBER 100 (not string "100") — guards int round-trip
    const loadedA = await loadFlow(pool, flowId);
    expect(loadedA).not.toBeNull();
    const n3A = loadedA!.nodes.find((n) => n.id === "n3");
    expect((n3A!.params as { amount: number }).amount).toBe(100);

    // Save docB and commit it
    await saveFlow(pool, flowId, docB);
    const cB = randomUUID();
    const rB = await commitFlow(pool, flowId, cB, "v2 amount 90");
    expect(rB.ok).toBe(true);
    if (!rB.ok) throw new Error("unreachable");
    expect(rB.commit.parentId).toBe(cA); // parent is first commit

    // listCommits — newest first, length >= 2, first is cB
    const commits = await listCommits(pool, flowId);
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0].id).toBe(cB);

    // rollbackToCommit — forward-commit restoring docA
    const cR = randomUUID();
    const result = await rollbackToCommit(pool, flowId, cA, cR);
    expect(result).not.toBeNull();
    expect(result!.commit.id).toBe(cR);
    expect(result!.commit.authorNote).toBe(`rollback to ${cA.slice(0, 8)}`);

    // loadFlow should now match docA
    const loadedRolledBack = await loadFlow(pool, flowId);
    expect(loadedRolledBack).toEqual(docA);

    // listCommits should have 3 entries now (cA, cB, cR)
    const commitsAfter = await listCommits(pool, flowId);
    expect(commitsAfter.length).toBe(3);
    // newest is the rollback commit
    expect(commitsAfter[0].id).toBe(cR);
  });

  it("commitFlow returns empty when no nodes", async () => {
    const emptyFlowId = `test-rung2-empty-${Date.now()}`;
    await saveFlow(pool, emptyFlowId, { nodes: [], edges: [], views: [] });
    const r = await commitFlow(pool, emptyFlowId, randomUUID(), "should fail");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("empty");
  });

  it("commitFlow returns no-branch when flow not saved", async () => {
    const r = await commitFlow(pool, "nonexistent-flow-rung2", randomUUID(), "x");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("no-branch");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("loadCommitSnapshot", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const flowId = `test-rung3a-snapshot-${Date.now()}`;

  afterAll(() => pool.end());

  it("returns the committed GraphDocument for a valid commitId", async () => {
    await saveFlow(pool, flowId, docA);
    const cId = randomUUID();
    const r = await commitFlow(pool, flowId, cId, "snap test");
    expect(r.ok).toBe(true);

    const snap = await loadCommitSnapshot(pool, flowId, cId);
    expect(snap).toEqual(docA);
  });

  it("returns null for a bogus commitId", async () => {
    const snap = await loadCommitSnapshot(pool, flowId, "bogus-id");
    expect(snap).toBeNull();
  });

  it("returns null for a valid commitId belonging to a different flow (cross-flow guard)", async () => {
    // Commit in flowId, then try to read it via a different flowId
    await saveFlow(pool, flowId, docA);
    const cId = randomUUID();
    await commitFlow(pool, flowId, cId, "other");

    const snap = await loadCommitSnapshot(pool, "other-flow-rung3a", cId);
    expect(snap).toBeNull();
  });
});

// ── Rung 3b: branch model + B09 concurrency ────────────────────────────────
describe.skipIf(!process.env.DATABASE_URL)("createBranch + branch isolation", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const flowId = `test-rung3b-${Date.now()}`;

  afterAll(() => pool.end());

  it("createBranch copies the source commit's snapshot into the new branch", async () => {
    await saveFlow(pool, flowId, docA);
    const cId = randomUUID();
    const r = await commitFlow(pool, flowId, cId, "v1 amount 100");
    expect(r.ok).toBe(true);

    const newBranchId = randomUUID();
    const branch = await createBranch(pool, flowId, "experiment", cId, newBranchId);
    expect(branch).not.toBeNull();
    expect(branch!.id).toBe(newBranchId);
    expect(branch!.flowId).toBe(flowId);
    expect(branch!.name).toBe("experiment");
    expect(branch!.headCommitId).toBe(cId);
    expect(branch!.baseCommitId).toBe(cId);

    // The new branch's live tables equal the forked commit's snapshot
    const onBranch = await loadFlow(pool, flowId, newBranchId);
    expect(onBranch).toEqual(docA);
  });

  it("createBranch returns null for an unknown fromCommitId", async () => {
    const branch = await createBranch(pool, flowId, "bogus", "no-such-commit", randomUUID());
    expect(branch).toBeNull();
  });

  it("writing a branch does NOT touch main (branch isolation)", async () => {
    // main starts at docA (amount 100); commit so we can fork
    await saveFlow(pool, flowId, docA);
    const cId = randomUUID();
    await commitFlow(pool, flowId, cId, "base for isolation");

    const branchId = randomUUID();
    await createBranch(pool, flowId, "iso", cId, branchId);

    // Edit ONLY the branch → amount 90
    await saveFlow(pool, flowId, docB, branchId);

    const onBranch = await loadFlow(pool, flowId, branchId);
    const onMain = await loadFlow(pool, flowId); // default branch
    const branchAmount = (onBranch!.nodes.find((n) => n.id === "n3")!.params as { amount: number }).amount;
    const mainAmount = (onMain!.nodes.find((n) => n.id === "n3")!.params as { amount: number }).amount;

    expect(branchAmount).toBe(90); // the branch edit landed
    expect(mainAmount).toBe(100);  // main is untouched — the key proof
  });

  it("branchExists: true for own-flow branch, false for wrong-flow", async () => {
    await saveFlow(pool, flowId, docA); // bootstraps `${flowId}-main`
    expect(await branchExists(pool, flowId, `${flowId}-main`)).toBe(true);
    // Same branch id, different flow → false (cross-flow guard, B-1)
    expect(await branchExists(pool, "some-other-flow", `${flowId}-main`)).toBe(false);
    // Unknown branch id → false
    expect(await branchExists(pool, flowId, "no-such-branch")).toBe(false);
  });

  it("B17 — rollbackToCommit rejects a commit from another branch", async () => {
    const mainBranchId = `${flowId}-main`;

    await saveFlow(pool, flowId, docA);
    const cMain = randomUUID();
    await commitFlow(pool, flowId, cMain, "main v1");

    const branchId = randomUUID();
    await createBranch(pool, flowId, "exp", cMain, branchId);

    await saveFlow(pool, flowId, docB, branchId);
    const cExp = randomUUID();
    await commitFlow(pool, flowId, cExp, "exp v1", branchId);

    const mainBefore = await loadFlow(pool, flowId, mainBranchId);
    expect(mainBefore).toEqual(docA);

    const result = await rollbackToCommit(
      pool,
      flowId,
      cExp,
      randomUUID(),
      mainBranchId,
    );
    expect(result).toBeNull();

    const mainAfter = await loadFlow(pool, flowId, mainBranchId);
    expect(mainAfter).toEqual(mainBefore);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("B09 — sequential persistRun build a linear parent chain", () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const flowId = `test-rung3b-b09-${Date.now()}`;

  afterAll(() => pool.end());

  it("two SEQUENTIAL persistRun → second commit's parent is the first (no fork)", async () => {
    await saveFlow(pool, flowId, docA);

    const commit1 = randomUUID();
    await persistRun(pool, flowId, commit1, docA, []);

    const commit2 = randomUUID();
    await persistRun(pool, flowId, commit2, docA, []);

    const commits = await listCommits(pool, flowId);
    const byId = new Map(commits.map((cm) => [cm.id, cm]));

    // Both run-commits exist
    expect(byId.has(commit1)).toBe(true);
    expect(byId.has(commit2)).toBe(true);
    // commit1 is the first run on a fresh branch → no parent
    expect(byId.get(commit1)!.parentId).toBeNull();
    // commit2 chains onto commit1 (FOR UPDATE serialized the head read) —
    // a linear C0→A→B chain, NOT two commits both parented at null.
    expect(byId.get(commit2)!.parentId).toBe(commit1);
  });
});
