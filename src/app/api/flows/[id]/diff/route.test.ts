import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({ loadCommitSnapshot: vi.fn() }));

import { GET } from "./route";
import { loadCommitSnapshot } from "@/lib/flow-repo";

const snapA = {
  nodes: [
    { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
    { id: "n3", type: "action.stripe.charge", params: { amount: 100, currency: "usd" }, isDraftSafe: false },
  ],
  edges: [],
  views: [],
};

const snapB = {
  nodes: [
    { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
    { id: "n3", type: "action.stripe.charge", params: { amount: 90, currency: "usd" }, isDraftSafe: false },
  ],
  edges: [],
  views: [],
};

const BASE_URL = "http://x/api/flows/demo/diff";

describe("GET /api/flows/[id]/diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("missing from → 400", async () => {
    const res = await GET(
      new Request(`${BASE_URL}?to=b`),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing from\/to/i);
  });

  it("missing to → 400", async () => {
    const res = await GET(
      new Request(`${BASE_URL}?from=a`),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing from\/to/i);
  });

  it("unknown from (first loadCommitSnapshot → null) → 400", async () => {
    vi.mocked(loadCommitSnapshot).mockResolvedValueOnce(null);
    const res = await GET(
      new Request(`${BASE_URL}?from=no-such&to=b`),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("no-such");
  });

  it("unknown to (second loadCommitSnapshot → null) → 400", async () => {
    vi.mocked(loadCommitSnapshot)
      .mockResolvedValueOnce(snapA as never)
      .mockResolvedValueOnce(null);
    const res = await GET(
      new Request(`${BASE_URL}?from=a&to=no-such`),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("no-such");
  });

  it("happy path → 200 with diffGraph result (n3 params.amount modified)", async () => {
    vi.mocked(loadCommitSnapshot)
      .mockResolvedValueOnce(snapA as never)
      .mockResolvedValueOnce(snapB as never);

    const res = await GET(
      new Request(`${BASE_URL}?from=a&to=b`),
      { params: Promise.resolve({ id: "demo" }) },
    );
    expect(res.status).toBe(200);

    const diff = await res.json();
    expect(diff.nodes.modified).toHaveLength(1);
    expect(diff.nodes.modified[0].id).toBe("n3");

    const amountChange = diff.nodes.modified[0].fieldChanges.find(
      (fc: { field: string }) => fc.field === "params.amount",
    );
    expect(amountChange).toEqual({ field: "params.amount", before: 100, after: 90 });
  });
});
