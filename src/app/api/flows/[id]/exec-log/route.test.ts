import { describe, it, expect, vi } from "vitest";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  listExecLog: vi.fn(),
}));

import { GET } from "./route";
import { listExecLog } from "@/lib/flow-repo";
import type { ExecLogEntry } from "@/lib/contract";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

const mockExecLogEntries: ExecLogEntry[] = [
  {
    id: "exec1",
    flowId: "demo",
    commitId: "c1",
    nodeId: "n2",
    actionType: "action.stripe.charge",
    request: { amount: 100 },
    response: { id: "ch_123" },
    status: "success",
    createdAt: new Date().toISOString(),
  },
  {
    id: "exec2",
    flowId: "demo",
    commitId: "c1",
    nodeId: "n3",
    actionType: "action.slack.post",
    request: { channel: "#revenue" },
    response: { ok: true },
    status: "success",
    createdAt: new Date().toISOString(),
  },
];

describe("GET /api/flows/[id]/exec-log", () => {
  it("returns 200 with exec-log array", async () => {
    vi.mocked(listExecLog).mockResolvedValueOnce(mockExecLogEntries);
    const res = await GET(
      new Request("http://x/api/flows/demo/exec-log"),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockExecLogEntries);
  });

  it("unknown flow → 200 with empty array", async () => {
    vi.mocked(listExecLog).mockResolvedValueOnce([]);
    const res = await GET(
      new Request("http://x/api/flows/unknown/exec-log"),
      { params: Promise.resolve({ id: "unknown" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("error → 500", async () => {
    vi.mocked(listExecLog).mockRejectedValueOnce(new Error("db boom"));
    const res = await GET(
      new Request("http://x/api/flows/demo/exec-log"),
      PARAMS,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "internal server error" });
  });
});
