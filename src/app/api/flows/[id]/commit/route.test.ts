import { describe, it, expect, vi } from "vitest";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  commitFlow: vi.fn(),
}));

import { POST } from "./route";
import { commitFlow } from "@/lib/flow-repo";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

function makeReq(body: unknown): Request {
  return new Request("http://x/api/flows/demo/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockCommitMeta = {
  id: "abc123",
  parentId: null,
  authorNote: "test note",
  createdAt: new Date().toISOString(),
};

describe("POST /api/flows/[id]/commit", () => {
  it("non-string authorNote → 400", async () => {
    const res = await POST(makeReq({ authorNote: 42 }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("authorNote too long → 400", async () => {
    const res = await POST(makeReq({ authorNote: "x".repeat(281) }), PARAMS);
    expect(res.status).toBe(400);
  });

  it("invalid JSON body → 400", async () => {
    const req = new Request("http://x/api/flows/demo/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(400);
  });

  it("commitFlow returns no-branch → 404", async () => {
    vi.mocked(commitFlow).mockResolvedValueOnce({ ok: false, reason: "no-branch" });
    const res = await POST(makeReq({ authorNote: "v1" }), PARAMS);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("save first");
  });

  it("commitFlow returns empty → 400", async () => {
    vi.mocked(commitFlow).mockResolvedValueOnce({ ok: false, reason: "empty" });
    const res = await POST(makeReq({ authorNote: "v1" }), PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("empty graph");
  });

  it("happy path → 200 with CommitMeta body", async () => {
    vi.mocked(commitFlow).mockResolvedValueOnce({ ok: true, commit: mockCommitMeta });
    const res = await POST(makeReq({ authorNote: "v1" }), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockCommitMeta);
  });

  it("missing authorNote defaults to empty string → 200", async () => {
    vi.mocked(commitFlow).mockResolvedValueOnce({ ok: true, commit: mockCommitMeta });
    const res = await POST(makeReq({}), PARAMS);
    expect(res.status).toBe(200);
  });
});
