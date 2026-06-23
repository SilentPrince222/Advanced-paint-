import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExecLogViewer } from "./exec-log-viewer";
import { listExecLog } from "@/lib/flow-client";
import type { ExecLogEntry } from "@/lib/contract";

vi.mock("@/lib/flow-client", () => ({
  DEMO_FLOW_ID: "demo",
  listExecLog: vi.fn(),
}));

const storeState = { execLogNonce: 0, bumpExecLog: vi.fn() };

vi.mock("@/lib/flow-store", () => ({
  useFlowStore: (selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
}));

describe("ExecLogViewer", () => {
  const mockExecLogEntries: ExecLogEntry[] = [
    {
      id: "exec1",
      flowId: "demo",
      commitId: "c1",
      nodeId: "n2",
      actionType: "action.stripe.charge",
      request: { amount: 100 },
      response: { chargeId: "mock_ch_12345678", mock: true },
      status: "success",
      createdAt: new Date("2024-01-01T12:00:00Z").toISOString(),
    },
    {
      id: "exec2",
      flowId: "demo",
      commitId: "c1",
      nodeId: "n3",
      actionType: "action.slack.post",
      request: { channel: "#revenue" },
      response: { ok: true, mock: true },
      status: "success",
      createdAt: new Date("2024-01-01T12:01:00Z").toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    storeState.execLogNonce = 0;
    vi.mocked(listExecLog).mockResolvedValue(mockExecLogEntries);
  });

  it("renders rows from mocked listExecLog", async () => {
    render(<ExecLogViewer />);

    await waitFor(() => {
      expect(screen.getByText("action.stripe.charge")).toBeTruthy();
      expect(screen.getByText("action.slack.post")).toBeTruthy();
    });
  });

  it("renders [MOCK] badge when response.mock is true", async () => {
    render(<ExecLogViewer />);

    await waitFor(() => {
      expect(screen.getAllByText("MOCK")).toHaveLength(2);
    });
  });

  it("renders badge with trigger-enforced append-only text", async () => {
    render(<ExecLogViewer />);

    await waitFor(() => {
      expect(
        screen.getByText(/trigger-enforced append-only/i),
      ).toBeTruthy();
    });
  });

  it("renders empty state when no executions", async () => {
    vi.mocked(listExecLog).mockResolvedValueOnce([]);
    render(<ExecLogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/No executions yet/i)).toBeTruthy();
    });
  });

  it("renders error state on fetch failure", async () => {
    vi.mocked(listExecLog).mockRejectedValueOnce(new Error("fetch failed"));
    render(<ExecLogViewer />);

    await waitFor(() => {
      expect(screen.getByText(/fetch failed/i)).toBeTruthy();
    });
  });

  it("re-fetches when execLogNonce changes", async () => {
    const { rerender } = render(<ExecLogViewer />);
    await waitFor(() => {
      expect(vi.mocked(listExecLog)).toHaveBeenCalledTimes(1);
    });

    storeState.execLogNonce = 1;
    rerender(<ExecLogViewer />);

    await waitFor(() => {
      expect(vi.mocked(listExecLog)).toHaveBeenCalledTimes(2);
    });
  });
});
