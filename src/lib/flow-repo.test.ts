import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import { saveFlow, loadFlow, commitFlow, listCommits, rollbackToCommit } from "./flow-repo";
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
