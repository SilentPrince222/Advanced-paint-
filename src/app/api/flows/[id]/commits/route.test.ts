import { describe, it, expect, vi } from "vitest";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  listCommits: vi.fn(),
}));

import { GET } from "./route";
import { listCommits } from "@/lib/flow-repo";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

const mockCommits = [
  {
    id: "c2",
    parentId: "c1",
    authorNote: "v2",
    createdAt: new Date().toISOString(),
  },
  {
    id: "c1",
    parentId: null,
    authorNote: "v1",
    createdAt: new Date().toISOString(),
  },
];

describe("GET /api/flows/[id]/commits", () => {
  it("returns 200 with commit array", async () => {
    vi.mocked(listCommits).mockResolvedValueOnce(mockCommits);
    const res = await GET(
      new Request("http://x/api/flows/demo/commits"),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockCommits);
  });

  it("unknown flow → 200 with empty array", async () => {
    vi.mocked(listCommits).mockResolvedValueOnce([]);
    const res = await GET(
      new Request("http://x/api/flows/unknown/commits"),
      { params: Promise.resolve({ id: "unknown" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});
