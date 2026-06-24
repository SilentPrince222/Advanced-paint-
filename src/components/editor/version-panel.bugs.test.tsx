import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { useFlowStore } from "@/lib/flow-store";

vi.mock("@/lib/flow-client", () => ({
  DEMO_FLOW_ID: "demo",
  saveFlowToServer: vi.fn().mockResolvedValue(undefined),
  commitFlow: vi.fn(),
  listCommits: vi.fn(),
  rollbackFlow: vi.fn(),
  diffFlow: vi.fn(),
  listBranches: vi.fn().mockResolvedValue([]),
  createBranch: vi.fn(),
  listExecLog: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/editor/diff-view", () => ({
  DiffView: () => <div data-testid="diff-view" />,
}));

vi.mock("@/components/editor/exec-log-viewer", () => ({
  ExecLogViewer: () => <div data-testid="exec-log-viewer" />,
}));

import { VersionPanel } from "./version-panel";
import { listCommits, saveFlowToServer } from "@/lib/flow-client";

const mockCommitMeta = {
  id: "aaaabbbbccccdddd",
  parentId: null,
  authorNote: "v1",
  createdAt: new Date().toISOString(),
};

describe("VersionPanel bug regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFlowStore.setState({
      nodes: [],
      edges: [],
      currentBranchId: undefined,
      execLogNonce: 0,
    });
    vi.mocked(listCommits).mockResolvedValue([mockCommitMeta]);
    vi.mocked(saveFlowToServer).mockResolvedValue(undefined);
  });

  it("B32 — Commit must stay disabled while a run is in flight", async () => {
    useFlowStore.setState({ running: true } as never);

    render(<VersionPanel />);

    const commitBtn = await screen.findByRole("button", { name: /commit/i });
    expect(commitBtn).toBeDisabled();
  });

  it("B33 — bumpExecLog must refetch commits and branches for the version panel", async () => {
    const { rerender } = render(<VersionPanel />);

    await waitFor(() => {
      expect(vi.mocked(listCommits)).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useFlowStore.getState().bumpExecLog();
    });

    // Re-render so a subscribed nonce would trigger a refetch.
    rerender(<VersionPanel />);

    await waitFor(() => {
      expect(vi.mocked(listCommits)).toHaveBeenCalledTimes(2);
    });
  });
});
