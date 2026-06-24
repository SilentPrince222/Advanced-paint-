import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  loadFlow: vi.fn(),
  saveFlow: vi.fn(),
  branchExists: vi.fn(),
}));

import { GET } from "./route";
import { loadFlow } from "@/lib/flow-repo";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

describe("API route logging — M6", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("M6 — GET /flows/:id logs only the error message, not the full pg error object", async () => {
    const pgError = Object.assign(new Error("connection refused"), {
      query: "SELECT * FROM node WHERE flow_id = $1",
      detail: "password authentication failed for user postgres",
    });
    vi.mocked(loadFlow).mockRejectedValueOnce(pgError);

    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(new Request("http://x/api/flows/demo"), PARAMS);

    expect(res.status).toBe(500);
    expect(logSpy).toHaveBeenCalledWith(
      "[GET /api/flows/:id]",
      "connection refused",
    );
    expect(JSON.stringify(logSpy.mock.calls[0] ?? [])).not.toContain("SELECT");

    logSpy.mockRestore();
  });
});
