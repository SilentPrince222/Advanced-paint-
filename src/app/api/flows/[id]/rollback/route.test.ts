import { describe, it, expect, vi } from "vitest";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  rollbackToCommit: vi.fn(),
}));

import { POST } from "./route";
import { rollbackToCommit } from "@/lib/flow-repo";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

function makeReq(body: unknown): Request {
  return new Request("http://x/api/flows/demo/rollback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockResult = {
  commit: {
    id: "newcommit",
    parentId: "oldhead",
    authorNote: "rollback to abc12345",
    createdAt: new Date().toISOString(),
  },
  doc: {
    nodes: [{ id: "n1", type: "trigger.webhook" as const, params: {}, isDraftSafe: true }],
    edges: [],
    views: [],
  },
};

describe("POST /api/flows/[id]/rollback", () => {
  it("missing toCommitId → 400", async () => {
    const res = await POST(makeReq({}), PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("missing toCommitId");
  });

  it("empty string toCommitId → 400", async () => {
    const res = await POST(makeReq({ toCommitId: "" }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("non-string toCommitId → 400", async () => {
    const res = await POST(makeReq({ toCommitId: 42 }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("invalid JSON body → 400", async () => {
    const req = new Request("http://x/api/flows/demo/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(400);
  });

  it("rollbackToCommit returns null → 404", async () => {
    vi.mocked(rollbackToCommit).mockResolvedValueOnce(null);
    const res = await POST(makeReq({ toCommitId: "abc123" }), PARAMS);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("commit not found");
  });

  it("happy path → 200 with {commit, doc}", async () => {
    vi.mocked(rollbackToCommit).mockResolvedValueOnce(mockResult);
    const res = await POST(makeReq({ toCommitId: "abc123" }), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockResult);
  });
});
