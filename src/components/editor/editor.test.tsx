import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Editor } from "./editor";
import * as client from "@/lib/flow-client";
import { useFlowStore } from "@/lib/flow-store";

vi.mock("./flow-canvas", () => ({ FlowCanvas: () => null }));
vi.mock("@/lib/flow-client", () => ({
  DEMO_FLOW_ID: "demo",
  fetchFlow: vi.fn().mockResolvedValue(null),
  saveFlowToServer: vi.fn().mockResolvedValue(undefined),
  runFlow: vi.fn(),
  listCommits: vi.fn().mockResolvedValue([]),
  commitFlow: vi.fn(),
  rollbackFlow: vi.fn(),
}));

beforeEach(async () => {
  await act(async () => {
    useFlowStore.setState({ nodes: [], edges: [] });
  });
  vi.clearAllMocks();
  // Re-apply default mock implementations after clearAllMocks
  (client.fetchFlow as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (client.saveFlowToServer as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (client.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

it("B13 — Save status stuck 'saved': after an edit the button must revert to 'Save' (dirty)", async () => {
  render(<Editor />);
  await waitFor(() => screen.getByRole("button", { name: "Save" }));

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => screen.getByRole("button", { name: "Saved" }));

  act(() => {
    useFlowStore.getState().addNode({ type: "trigger.webhook" });
  });

  // CORRECT behavior: after an edit the button reverts to "Save" (dirty).
  // Current code keeps "Saved" → RED.
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Saved" })).toBeNull();
  });
});

it("B12 — Save NOT disabled while a run is in flight: Save must be disabled during a run", async () => {
  // make runFlow hang so `running` stays true
  let release: ((v: unknown) => void) | undefined;
  (client.runFlow as ReturnType<typeof vi.fn>).mockReturnValue(
    new Promise((r) => { release = r; }),
  );

  render(<Editor />);
  await waitFor(() => screen.getByRole("button", { name: "Run" }));

  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => screen.getByRole("button", { name: "Running…" }));

  // CORRECT behavior: Save is disabled during a run.
  // Current code leaves it enabled → RED.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  release?.(undefined); // cleanup the hanging promise
});
