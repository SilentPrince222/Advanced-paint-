import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/flow-repo", () => ({
  loadFlow: vi.fn(),
  persistRun: vi.fn(),
  branchExists: vi.fn(),
}));
vi.mock("@/lib/stripe-executor", () => ({
  executeAction: vi.fn().mockResolvedValue({
    response: { chargeId: "ch_test" },
    status: "success",
  }),
}));
vi.mock("@/lib/interpreter", () => ({
  runGraph: vi.fn().mockReturnValue({
    steps: [
      {
        kind: "action",
        nodeId: "n-stripe",
        type: "action.stripe.charge",
        request: { amount: 100, currency: "usd" },
      },
    ],
  }),
  mockResponse: vi.fn().mockReturnValue({ chargeId: "mock_ch", mock: true }),
}));

import { POST } from "./route";
import { loadFlow, persistRun } from "@/lib/flow-repo";
import { executeAction } from "@/lib/stripe-executor";
import { mockResponse } from "@/lib/interpreter";

const PARAMS = { params: Promise.resolve({ id: "demo" }) };

const mockDoc = {
  nodes: [
    {
      id: "n-stripe",
      type: "action.stripe.charge" as const,
      params: { amount: 100, currency: "usd" },
      isDraftSafe: false,
    },
  ],
  edges: [],
  views: [],
};

const STRIPE_REQUEST = { amount: 100, currency: "usd" };

function stripeIdempotencyKey(
  flowId: string,
  branch: string | undefined,
  nodeId: string,
  request: Record<string, unknown>,
  commitId?: string,
): string {
  const normalizedBranch = branch ?? `${flowId}-main`;
  const base = `${flowId}:${normalizedBranch}:${nodeId}:${JSON.stringify(request)}`;
  return createHash("sha256")
    .update(commitId ? `${base}:${commitId}` : base)
    .digest("hex")
    .slice(0, 32);
}

function runReq(branch?: string): Request {
  const url =
    branch === undefined
      ? "http://x/api/flows/demo/run"
      : `http://x/api/flows/demo/run?branch=${encodeURIComponent(branch)}`;
  return new Request(url, { method: "POST" });
}

describe("POST /api/flows/[id]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadFlow).mockResolvedValue(mockDoc);
    vi.mocked(persistRun).mockResolvedValue(undefined);
    vi.mocked(executeAction).mockResolvedValue({
      response: { chargeId: "ch_test" },
      status: "success",
    });
    delete process.env.MOCK_MODE;
  });

  it("B21 — ?branch= empty string → 400 unknown branch", async () => {
    const res = await POST(
      new Request("http://x/api/flows/demo/run?branch=", { method: "POST" }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("unknown branch");
  });

  it("B23 — two identical POST /run calls must reuse the same Stripe idempotency key", async () => {
    await POST(runReq(), PARAMS);
    await POST(runReq(), PARAMS);

    expect(vi.mocked(executeAction).mock.calls.length).toBe(2);
    const keys = vi.mocked(executeAction).mock.calls.map((c) => c[2]);
    expect(keys[0]).toBe(keys[1]);
  });

  it("B26 — idempotency key must not flip when branch param is omitted vs explicit main id", () => {
    const commitId = "same-run";
    const implicit = stripeIdempotencyKey(
      "demo",
      undefined,
      "n-stripe",
      STRIPE_REQUEST,
      commitId,
    );
    const explicit = stripeIdempotencyKey(
      "demo",
      "demo-main",
      "n-stripe",
      STRIPE_REQUEST,
      commitId,
    );

    expect(implicit).toBe(explicit);
  });

  it("B27 — distinct runs must not reuse the same Stripe idempotency key", () => {
    const runA = stripeIdempotencyKey(
      "demo",
      undefined,
      "n-stripe",
      STRIPE_REQUEST,
      "commit-a",
    );
    const runB = stripeIdempotencyKey(
      "demo",
      undefined,
      "n-stripe",
      STRIPE_REQUEST,
      "commit-b",
    );

    expect(runA).not.toBe(runB);
  });

  it("B28 — non-stripe action with no executor must not be recorded as success in live mode", async () => {
    vi.mocked(executeAction).mockResolvedValue(null);
    vi.mocked(mockResponse).mockReturnValue({ ok: true, mock: true });

    const res = await POST(runReq(), PARAMS);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      entries: Array<{ status: string; response: Record<string, unknown> }>;
    };
    expect(body.entries[0]?.status).toBe("failure");
    expect(vi.mocked(mockResponse)).toHaveBeenCalled();
  });

  it("B25 — second identical run must persist a new exec_log row (not 500)", async () => {
    await POST(runReq(), PARAMS);
    const res2 = await POST(runReq(), PARAMS);

    expect(res2.status).toBe(200);
    expect(vi.mocked(persistRun).mock.calls.length).toBe(2);

    const execIds = vi.mocked(persistRun).mock.calls.map(
      (c) => c[4][0]?.execId,
    );
    expect(execIds[0]).toBeDefined();
    expect(execIds[1]).toBeDefined();
    expect(execIds[0]).not.toBe(execIds[1]);
  });
});
