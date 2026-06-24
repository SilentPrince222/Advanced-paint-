import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { useFlowStore } from "@/lib/flow-store";

vi.mock("@/lib/flow-client", () => ({
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
import {
  createBranch,
  listBranches,
  listCommits,
  saveFlowToServer,
} from "@/lib/flow-client";

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

    render(<VersionPanel flowId="demo" />);

    const commitBtn = await screen.findByRole("button", { name: /commit/i });
    expect(commitBtn).toBeDisabled();
  });

  it("B33 — bumpExecLog must refetch commits and branches for the version panel", async () => {
    const { rerender } = render(<VersionPanel flowId="demo" />);

    await waitFor(() => {
      expect(vi.mocked(listCommits)).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useFlowStore.getState().bumpExecLog();
    });

    // Re-render so a subscribed nonce would trigger a refetch.
    rerender(<VersionPanel flowId="demo" />);

    await waitFor(() => {
      expect(vi.mocked(listCommits)).toHaveBeenCalledTimes(2);
    });
  });

  it("M3 — branch creation must switch currentBranchId before refresh fetches lists", async () => {
    const mainBranch = {
      id: "demo-main",
      flowId: "demo",
      name: "main",
      headCommitId: mockCommitMeta.id,
      baseCommitId: null,
    };
    const featureBranch = {
      id: "demo-feature",
      flowId: "demo",
      name: "feature",
      headCommitId: mockCommitMeta.id,
      baseCommitId: mockCommitMeta.id,
    };

    useFlowStore.setState({ currentBranchId: mainBranch.id });

    vi.mocked(listBranches).mockResolvedValue([mainBranch]);
    vi.mocked(createBranch).mockResolvedValue(featureBranch);

    let branchIdDuringPostCreateRefresh: string | undefined;
    vi.mocked(listCommits).mockImplementation(async () => {
      if (vi.mocked(createBranch).mock.calls.length > 0) {
        branchIdDuringPostCreateRefresh =
          useFlowStore.getState().currentBranchId;
      }
      return [mockCommitMeta];
    });

    render(<VersionPanel flowId="demo" />);
    await screen.findByRole("button", { name: /branch/i });

    const branchInput = screen.getByPlaceholderText(/branch name/i);
    fireEvent.change(branchInput, { target: { value: "feature" } });
    fireEvent.click(screen.getByRole("button", { name: /^branch$/i }));

    await waitFor(() => {
      expect(vi.mocked(createBranch)).toHaveBeenCalled();
    });

    expect(branchIdDuringPostCreateRefresh).toBe(featureBranch.id);
    expect(useFlowStore.getState().currentBranchId).toBe(featureBranch.id);
  });

  it("M5 — Rollback must stay disabled while a run is in flight", async () => {
    vi.mocked(listBranches).mockResolvedValue([
      {
        id: "demo-main",
        flowId: "demo",
        name: "main",
        headCommitId: mockCommitMeta.id,
        baseCommitId: null,
      },
    ]);
    useFlowStore.setState({ running: true } as never);

    render(<VersionPanel flowId="demo" />);

    const rollbackBtn = await screen.findByRole("button", { name: /rollback/i });
    expect(rollbackBtn).toBeDisabled();
  });

  it("m6 — list fetch failure must surface a refresh-failed indicator", async () => {
    vi.mocked(listCommits)
      .mockResolvedValueOnce([mockCommitMeta])
      .mockRejectedValueOnce(new Error("network down"));
    vi.mocked(listBranches)
      .mockResolvedValueOnce([
        {
          id: "demo-main",
          flowId: "demo",
          name: "main",
          headCommitId: mockCommitMeta.id,
          baseCommitId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "demo-main",
          flowId: "demo",
          name: "main",
          headCommitId: mockCommitMeta.id,
          baseCommitId: null,
        },
      ]);

    render(<VersionPanel flowId="demo" />);
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeInTheDocument();
    });

    act(() => {
      useFlowStore.getState().bumpExecLog();
    });

    await waitFor(() => {
      expect(screen.getByText(/refresh failed/i)).toBeInTheDocument();
    });
  });
});
