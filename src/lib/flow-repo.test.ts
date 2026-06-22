import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import { saveFlow, loadFlow } from "./flow-repo";
import type { GraphDocument } from "@/lib/contract";

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
