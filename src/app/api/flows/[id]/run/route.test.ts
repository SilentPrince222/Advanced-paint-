import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  loadFlow: vi.fn(),
  persistRun: vi.fn(),
  branchExists: vi.fn(),
}));

import { POST } from "./route";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

describe("POST /api/flows/[id]/run", () => {
  it("B21 — ?branch= empty string → 400 unknown branch", async () => {
    const res = await POST(
      new Request("http://x/api/flows/demo/run?branch=", { method: "POST" }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("unknown branch");
  });
});
