import { describe, it, expect, vi } from "vitest";

// Mock server-only deps BEFORE importing the route
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  saveFlow: vi.fn().mockResolvedValue(undefined),
  loadFlow: vi.fn(),
}));

import { PUT } from "./route";

// ── Helper ─────────────────────────────────────────────────────────────────

type Body = {
  nodes: { id: string; type: string; params: Record<string, unknown>; isDraftSafe: boolean }[];
  edges: { id: string; fromNodeId: string; toNodeId: string }[];
  views: { nodeId: string; x: number; y: number; width: number; height: number }[];
};

function validBody(): Body {
  return {
    nodes: [
      { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
    ],
    edges: [],
    views: [{ nodeId: "n1", x: 0, y: 0, width: 160, height: 80 }],
  };
}

function makeReq(body: unknown): Request {
  return new Request("http://x/api/flows/demo", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PUT /api/flows/[id] — bug regression", () => {
  it("B01 — wrong param type for action.stripe.charge (amount is a string) → 400", async () => {
    const body = validBody();
    body.nodes.push({
      id: "n2",
      type: "action.stripe.charge",
      params: { amount: "lots", currency: "usd" },
      isDraftSafe: false,
    });
    const res = await PUT(makeReq(body), PARAMS);
    expect(res.status).toBe(400);
  });

  it("B02 — fractional cents for action.stripe.charge (amount: 9.99) → 400", async () => {
    const body = validBody();
    body.nodes.push({
      id: "n2",
      type: "action.stripe.charge",
      params: { amount: 9.99, currency: "usd" },
      isDraftSafe: false,
    });
    const res = await PUT(makeReq(body), PARAMS);
    expect(res.status).toBe(400);
  });

  it("B03 — view x coordinate is Infinity (1e309) → 400", async () => {
    // 1e309 serialises to Infinity in JSON spec, but JSON.stringify turns it to null;
    // we need to send the raw JSON so the view arrives with Infinity.
    // JSON.stringify converts Infinity → null in the value, but we craft it by
    // building the request body string manually so that the number 1e309 is embedded.
    const rawBody = `{"nodes":[{"id":"n1","type":"trigger.webhook","params":{},"isDraftSafe":true}],"edges":[],"views":[{"nodeId":"n1","x":1e309,"y":0,"width":160,"height":80}]}`;
    const req = new Request("http://x/api/flows/demo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: rawBody,
    });
    const res = await PUT(req, PARAMS);
    expect(res.status).toBe(400);
  });

  it("B04 — edge toNodeId references non-existent node 'GHOST' → 400", async () => {
    const body = validBody();
    body.edges.push({ id: "e1", fromNodeId: "n1", toNodeId: "GHOST" });
    const res = await PUT(makeReq(body), PARAMS);
    expect(res.status).toBe(400);
  });

  it("B05 — duplicate node id 'dup' → 400", async () => {
    const body = validBody();
    body.nodes = [
      { id: "dup", type: "trigger.webhook", params: {}, isDraftSafe: true },
      { id: "dup", type: "trigger.webhook", params: {}, isDraftSafe: true },
    ];
    body.views = [{ nodeId: "dup", x: 0, y: 0, width: 160, height: 80 }];
    const res = await PUT(makeReq(body), PARAMS);
    expect(res.status).toBe(400);
  });

  it("B06 — malformed JSON body causes req.json() to throw outside try/catch → 400", async () => {
    const req = new Request("http://x/api/flows/demo", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    const res = await PUT(req, PARAMS);
    expect(res.status).toBe(400);
  });
});
