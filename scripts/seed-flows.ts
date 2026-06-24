import { Pool, type PoolClient } from "pg";
import type { GraphDocument } from "../src/lib/contract";
import { bootstrapFlow } from "../src/lib/flow-repo";

interface SeedFlow {
  id: string;
  name: string;
  doc: GraphDocument;
}

const SEEDS: SeedFlow[] = [
  {
    id: "seed-stripe",
    name: "Stripe Payment Flow",
    doc: {
      nodes: [
        { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
        { id: "n2", type: "action.stripe.charge", params: { amount: 2500, currency: "usd" }, isDraftSafe: false, credentialRef: "stripe-live" },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 400, y: 200, width: 160, height: 80 },
      ],
    },
  },
  {
    id: "seed-slack",
    name: "Slack Alert Pipeline",
    doc: {
      nodes: [
        { id: "n1", type: "trigger.schedule", params: { cron: "0 9 * * *" }, isDraftSafe: true },
        { id: "n2", type: "condition.if", params: { expression: "status == 'error'" }, isDraftSafe: true },
        { id: "n3", type: "action.slack.post", params: { channel: "#alerts", message: "Error detected" }, isDraftSafe: true },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
        { id: "e2", fromNodeId: "n2", toNodeId: "n3", condition: "true" },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 350, y: 200, width: 160, height: 80 },
        { nodeId: "n3", x: 600, y: 200, width: 160, height: 80 },
      ],
    },
  },
  {
    id: "seed-relay",
    name: "Simple Webhook Relay",
    doc: {
      nodes: [
        { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
        { id: "n2", type: "action.slack.post", params: { channel: "#general", message: "New event received" }, isDraftSafe: true },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 400, y: 200, width: 160, height: 80 },
      ],
    },
  },
];

async function insertGraph(client: PoolClient, branchId: string, doc: GraphDocument): Promise<void> {
  for (const n of doc.nodes) {
    await client.query(
      `INSERT INTO node (id, branch_id, type, params, credential_ref, is_draft_safe)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [n.id, branchId, n.type, JSON.stringify(n.params ?? {}), n.credentialRef ?? null, n.isDraftSafe],
    );
  }
  for (const e of doc.edges) {
    await client.query(
      `INSERT INTO edge (id, branch_id, from_node_id, to_node_id, condition)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.id, branchId, e.fromNodeId, e.toNodeId, e.condition ?? null],
    );
  }
  for (const v of doc.views) {
    await client.query(
      `INSERT INTO node_view (branch_id, node_id, x, y, width, height, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [branchId, v.nodeId, v.x, v.y, v.width, v.height, null],
    );
  }
}

async function seedOne(pool: Pool, seed: SeedFlow): Promise<void> {
  const exists = await pool.query(`SELECT 1 FROM flow WHERE id = $1`, [seed.id]);
  if (exists.rowCount && exists.rowCount > 0) {
    console.log(`  skip ${seed.name} — already exists`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await bootstrapFlow(client, seed.id, seed.name);

    const branchId = `${seed.id}-main`;

    await insertGraph(client, branchId, seed.doc);

    const commitId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "commit" (id, flow_id, branch_id, parent_id, author_note, graph_snapshot)
       VALUES ($1, $2, $3, NULL, $4, $5::jsonb)`,
      [commitId, seed.id, branchId, "initial setup", JSON.stringify(seed.doc)],
    );

    await client.query(`UPDATE branch SET head_commit_id = $1 WHERE id = $2`, [commitId, branchId]);

    await client.query("COMMIT");
    console.log(`  ok ${seed.name}`);
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  fail ${seed.name} — ${msg}`);
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const ca = process.env.DATABASE_CA_CERT;
  const pool = new Pool({
    connectionString: url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: 1,
  });

  console.log("Seeding flows...");
  try {
    for (const seed of SEEDS) {
      await seedOne(pool, seed);
    }
  } finally {
    await pool.end();
  }
  console.log("Done.");
}

void main();
