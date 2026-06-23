import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// vi.mock calls BEFORE imports of the module under test
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

// Mock DiffView to prevent it from firing diffFlow effects in panel tests
vi.mock("@/components/editor/diff-view", () => ({
  DiffView: () => <div data-testid="diff-view" />,
}));

vi.mock("@/lib/flow-store", () => {
  const toGraphDocument = vi.fn().mockReturnValue({
    nodes: [{ id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true }],
    edges: [],
    views: [],
  });
  const fromGraphDocument = vi.fn();
  const setCurrentBranchId = vi.fn();
  const bumpExecLog = vi.fn();
  const storeState = {
    nodes: [],
    edges: [],
    currentBranchId: undefined,
    setCurrentBranchId,
    execLogNonce: 0,
    bumpExecLog,
  };
  return {
    useFlowStore: Object.assign(
      (selector: (s: typeof storeState) => unknown) => selector(storeState),
      {
        getState: vi.fn().mockReturnValue({
          toGraphDocument,
          fromGraphDocument,
          currentBranchId: undefined,
          setCurrentBranchId,
          execLogNonce: 0,
          bumpExecLog,
        }),
      },
    ),
  };
});

import { VersionPanel } from "./version-panel";
import {
  commitFlow,
  createBranch,
  listBranches,
  listCommits,
  rollbackFlow,
  saveFlowToServer,
  diffFlow,
} from "@/lib/flow-client";
import { useFlowStore } from "@/lib/flow-store";

const mockCommitMeta = {
  id: "aaaabbbbccccdddd",
  parentId: null,
  authorNote: "v1",
  createdAt: new Date().toISOString(),
};

// A commit with a non-null parentId (required for the Diff button to be enabled)
const mockCommitWithParent = {
  id: "bbbbccccddddeeee",
  parentId: "aaaabbbbccccdddd",
  authorNote: "v2",
  createdAt: new Date().toISOString(),
};

const emptyDiff = {
  nodes: { added: [], removed: [], modified: [] },
  edges: { added: [], removed: [], modified: [] },
};

const mockDoc = {
  nodes: [{ id: "n1", type: "trigger.webhook" as const, params: {}, isDraftSafe: true }],
  edges: [] as never[],
  views: [] as never[],
};

const mockMainBranch = {
  id: "demo-main",
  flowId: "demo",
  name: "main",
  headCommitId: "aaaabbbbccccdddd",
  baseCommitId: null,
};

describe("VersionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCommits).mockResolvedValue([]);
    vi.mocked(listBranches).mockResolvedValue([]);
    vi.mocked(diffFlow).mockResolvedValue(emptyDiff as never);
  });

  it("renders Commit button and input", async () => {
    render(<VersionPanel />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/commit note/i)).toBeTruthy();
  });

  it("Commit button calls saveFlowToServer then commitFlow", async () => {
    vi.mocked(commitFlow).mockResolvedValue(mockCommitMeta);
    vi.mocked(listCommits).mockResolvedValue([mockCommitMeta]);

    render(<VersionPanel />);

    const input = screen.getByPlaceholderText(/commit note/i);
    fireEvent.change(input, { target: { value: "v1" } });

    const btn = screen.getByRole("button", { name: /commit/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(vi.mocked(saveFlowToServer)).toHaveBeenCalledWith(
        "demo",
        expect.objectContaining({ nodes: expect.any(Array) }),
        undefined,
      );
      expect(vi.mocked(commitFlow)).toHaveBeenCalledWith("demo", "v1", undefined);
    });
  });

  it("Rollback button calls rollbackFlow then store.fromGraphDocument", async () => {
    vi.mocked(listCommits).mockResolvedValue([mockCommitMeta]);
    vi.mocked(rollbackFlow).mockResolvedValue({ commit: mockCommitMeta, doc: mockDoc });

    render(<VersionPanel />);

    // Wait for the commit list to load
    await waitFor(() => {
      expect(screen.getByText("v1")).toBeTruthy();
    });

    const rollbackBtn = screen.getByRole("button", { name: /rollback/i });
    fireEvent.click(rollbackBtn);

    await waitFor(() => {
      expect(vi.mocked(rollbackFlow)).toHaveBeenCalledWith(
        "demo",
        mockCommitMeta.id,
        undefined,
      );
      expect(useFlowStore.getState().fromGraphDocument).toHaveBeenCalledWith(mockDoc);
    });
  });

  it("Diff button is disabled when parentId is null", async () => {
    vi.mocked(listCommits).mockResolvedValue([mockCommitMeta]); // parentId: null

    render(<VersionPanel />);

    await waitFor(() => {
      expect(screen.getByText("v1")).toBeTruthy();
    });

    const diffBtn = screen.getByRole("button", { name: /^diff$/i });
    expect(diffBtn).toHaveProperty("disabled", true);
  });

  it("Diff button enabled when parentId non-null; click shows DiffView overlay", async () => {
    vi.mocked(listCommits).mockResolvedValue([mockCommitWithParent]);

    render(<VersionPanel />);

    await waitFor(() => {
      expect(screen.getByText("v2")).toBeTruthy();
    });

    const diffBtn = screen.getByRole("button", { name: /^diff$/i });
    expect(diffBtn).toHaveProperty("disabled", false);

    fireEvent.click(diffBtn);

    await waitFor(() => {
      expect(screen.getByTestId("diff-view")).toBeTruthy();
    });
  });

  it("selector renders the main option from listBranches and is enabled once loaded", async () => {
    vi.mocked(listBranches).mockResolvedValue([mockMainBranch]);

    render(<VersionPanel />);

    const select = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(select).toHaveProperty("disabled", false);
    });
    expect(select).toHaveProperty("value", "demo-main");
    expect(screen.getByRole("option", { name: "main" })).toBeTruthy();
  });

  it("picking a branch calls setCurrentBranchId with its id", async () => {
    const experimentBranch = {
      id: "branch-uuid",
      flowId: "demo",
      name: "experiment",
      headCommitId: null,
      baseCommitId: null,
    };
    vi.mocked(listBranches).mockResolvedValue([mockMainBranch, experimentBranch]);

    render(<VersionPanel />);

    const select = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(select).toHaveProperty("disabled", false);
    });

    fireEvent.change(select, { target: { value: "branch-uuid" } });

    await waitFor(() => {
      expect(useFlowStore.getState().setCurrentBranchId).toHaveBeenCalledWith(
        "branch-uuid",
      );
    });
  });

  it("Branch button forks from the active branch's headCommitId then setCurrentBranchId", async () => {
    // currentBranchId undefined → resolves to main; main.headCommitId = mockCommitMeta.id
    vi.mocked(listCommits).mockResolvedValue([mockCommitMeta]);
    vi.mocked(listBranches).mockResolvedValue([mockMainBranch]);
    const created = {
      id: "new-branch",
      flowId: "demo",
      name: "experiment",
      headCommitId: mockCommitMeta.id,
      baseCommitId: mockCommitMeta.id,
    };
    vi.mocked(createBranch).mockResolvedValue(created);

    render(<VersionPanel />);

    const nameInput = await screen.findByPlaceholderText(/branch name/i);
    fireEvent.change(nameInput, { target: { value: "experiment" } });

    const branchBtn = screen.getByRole("button", { name: /^branch$/i });
    await waitFor(() => {
      expect(branchBtn).toHaveProperty("disabled", false);
    });
    fireEvent.click(branchBtn);

    await waitFor(() => {
      expect(vi.mocked(createBranch)).toHaveBeenCalledWith(
        "demo",
        "experiment",
        mockCommitMeta.id,
      );
    });
    await waitFor(() => {
      expect(useFlowStore.getState().setCurrentBranchId).toHaveBeenCalledWith(
        "new-branch",
      );
    });
  });

  it("Branch button is disabled when the active branch has no headCommitId yet", async () => {
    const headlessMain = { ...mockMainBranch, headCommitId: null };
    vi.mocked(listCommits).mockResolvedValue([mockCommitMeta]);
    vi.mocked(listBranches).mockResolvedValue([headlessMain]);

    render(<VersionPanel />);

    const nameInput = await screen.findByPlaceholderText(/branch name/i);
    fireEvent.change(nameInput, { target: { value: "experiment" } });

    const branchBtn = screen.getByRole("button", { name: /^branch$/i });
    expect(branchBtn).toHaveProperty("disabled", true);
  });
});
