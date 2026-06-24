import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Editor } from "./editor";
import * as client from "@/lib/flow-client";
import { useFlowStore } from "@/lib/flow-store";

vi.mock("./flow-canvas", () => ({ FlowCanvas: () => null }));
vi.mock("./side-panel", () => ({
  SidePanel: () => <div data-testid="side-panel-stub" />,
}));
vi.mock("./version-panel", () => ({
  VersionPanel: () => null,
}));
vi.mock("@/lib/flow-client", () => ({
  fetchFlow: vi.fn().mockResolvedValue(null),
  saveFlowToServer: vi.fn().mockResolvedValue(undefined),
  runFlow: vi.fn(),
  listCommits: vi.fn().mockResolvedValue([]),
  commitFlow: vi.fn(),
  rollbackFlow: vi.fn(),
  diffFlow: vi.fn(),
  listBranches: vi.fn().mockResolvedValue([]),
  createBranch: vi.fn(),
  listExecLog: vi.fn().mockResolvedValue([]),
}));

describe("Editor bug regressions", () => {
  beforeEach(async () => {
    await act(async () => {
      useFlowStore.setState({ nodes: [], edges: [] });
    });
    vi.clearAllMocks();
    (client.fetchFlow as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (client.saveFlowToServer as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (client.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("B40 — Save during Run must not overwrite server state mid-run", async () => {
    let releaseSave: (() => void) | undefined;
    let saveCallCount = 0;

    (client.saveFlowToServer as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          saveCallCount += 1;
          releaseSave = resolve;
        }),
    );

    (client.runFlow as ReturnType<typeof vi.fn>).mockResolvedValue({
      entries: [],
      commitId: "aaaabbbbccccdddd",
    });

    render(<Editor flowId="test-flow" onBack={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Running…" })).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();

    fireEvent.click(saveBtn);
    expect(saveCallCount).toBe(1);

    releaseSave?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled(),
    );
  }, 15000);

  it("m1 — flow load failure must show an error banner with retry", async () => {
    (client.fetchFlow as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network down"),
    );

    render(<Editor flowId="test-flow" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
    });
  });

  it("m2 — save failure must show a persistent Save failed indicator", async () => {
    (client.saveFlowToServer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("save failed"),
    );

    render(<Editor flowId="test-flow" onBack={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/save failed/i)).toBeInTheDocument();
    });

    act(() => {
      useFlowStore.getState().addNode({ type: "trigger.webhook" });
    });

    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });

  it("M5 — Run must publish running=true to the store so VersionPanel can lock Rollback", async () => {
    let releaseSave: (() => void) | undefined;
    let releaseRun: ((v: unknown) => void) | undefined;

    (client.saveFlowToServer as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    (client.runFlow as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = resolve;
        }),
    );

    render(<Editor flowId="test-flow" onBack={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(useFlowStore.getState().running).toBe(true);
    });

    releaseSave?.();
    releaseRun?.({ entries: [], commitId: null });
    await waitFor(() => {
      expect(useFlowStore.getState().running).toBe(false);
    });
  }, 15000);
});
