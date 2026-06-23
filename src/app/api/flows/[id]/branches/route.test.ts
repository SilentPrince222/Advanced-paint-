import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({ createBranch: vi.fn(), listBranches: vi.fn() }));

import { GET, POST } from "./route";
import { createBranch, listBranches } from "@/lib/flow-repo";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

function makeReq(body: unknown): Request {
  return new Request("http://x/api/flows/demo/branches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockBranch = {
  id: "branch-uuid",
  flowId: "demo",
  name: "experiment",
  headCommitId: "c1",
  baseCommitId: "c1",
};

const mockList = [
  {
    id: "demo-main",
    flowId: "demo",
    name: "main",
    headCommitId: null,
    baseCommitId: null,
  },
  mockBranch,
];

describe("POST /api/flows/[id]/branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("missing name → 400", async () => {
    const res = await POST(makeReq({ fromCommitId: "c1" }), PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("name");
  });

  it("missing fromCommitId → 400", async () => {
    const res = await POST(makeReq({ name: "experiment" }), PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("fromCommitId");
  });

  it("unknown fromCommitId (createBranch → null) → 400", async () => {
    vi.mocked(createBranch).mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ name: "experiment", fromCommitId: "no-such" }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("no-such");
  });

  it("happy path → 200 with the created Branch", async () => {
    vi.mocked(createBranch).mockResolvedValueOnce(mockBranch);
    const res = await POST(
      makeReq({ name: "experiment", fromCommitId: "c1" }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockBranch);
  });
});

describe("GET /api/flows/[id]/branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path → 200 with the branch list", async () => {
    vi.mocked(listBranches).mockResolvedValueOnce(mockList);
    const res = await GET(new Request("http://x/api/flows/demo/branches"), PARAMS);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockList);
    expect(vi.mocked(listBranches)).toHaveBeenCalledWith(expect.anything(), "demo");
  });
});
