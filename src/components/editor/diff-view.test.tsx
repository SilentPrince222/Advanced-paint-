import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// vi.mock calls BEFORE imports of the module under test
vi.mock("@/lib/flow-client", () => ({
  diffFlow: vi.fn(),
}));

import { DiffView } from "./diff-view";
import { diffFlow } from "@/lib/flow-client";

const mockDiff = {
  nodes: {
    added: [
      {
        id: "n5",
        type: "action.slack.post" as const,
        params: { channel: "#new", message: "hi" },
        isDraftSafe: true,
      },
    ],
    removed: [],
    modified: [
      {
        id: "n3",
        type: "action.stripe.charge" as const,
        fieldChanges: [
          { field: "params.amount", before: 100, after: 90 },
        ],
      },
    ],
  },
  edges: {
    added: [],
    removed: [
      { id: "e3", fromNodeId: "n3", toNodeId: "n4" },
    ],
    modified: [],
  },
};

describe("DiffView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially, then renders diff sections", async () => {
    vi.mocked(diffFlow).mockResolvedValue(mockDiff as never);

    render(<DiffView flowId="demo" from="c1" to="c2" />);

    // Should call diffFlow with correct args
    expect(vi.mocked(diffFlow)).toHaveBeenCalledWith("demo", "c1", "c2");

    // Wait for diff to render
    await waitFor(() => {
      // params.amount field change values visible
      expect(screen.getByText("params.amount:")).toBeTruthy();
    });

    // amount before=100 and after=90
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByText("90")).toBeTruthy();
  });

  it("shows added node id", async () => {
    vi.mocked(diffFlow).mockResolvedValue(mockDiff as never);

    render(<DiffView flowId="demo" from="c1" to="c2" />);

    await waitFor(() => {
      // Added node n5 shows as a green "+" entry
      expect(screen.getByText(/\+ n5/)).toBeTruthy();
    });
  });

  it("shows removed edge id", async () => {
    vi.mocked(diffFlow).mockResolvedValue(mockDiff as never);

    render(<DiffView flowId="demo" from="c1" to="c2" />);

    await waitFor(() => {
      // Removed edge e3 shows as a red "−" entry
      expect(screen.getByText(/− e3/)).toBeTruthy();
    });
  });

  it("shows 'No changes.' when diff is empty", async () => {
    const emptyDiff = {
      nodes: { added: [], removed: [], modified: [] },
      edges: { added: [], removed: [], modified: [] },
    };
    vi.mocked(diffFlow).mockResolvedValue(emptyDiff as never);

    render(<DiffView flowId="demo" from="c1" to="c2" />);

    await waitFor(() => {
      expect(screen.getByText(/No changes\./)).toBeTruthy();
    });
  });

  it("shows error message when diffFlow rejects", async () => {
    vi.mocked(diffFlow).mockRejectedValue(new Error("diffFlow failed: 400 unknown commit"));

    render(<DiffView flowId="demo" from="c1" to="bad" />);

    await waitFor(() => {
      expect(screen.getByText(/diffFlow failed/)).toBeTruthy();
    });
  });

  it("B35 — StrictMode must fire diffFlow only once per mount", async () => {
    const emptyDiff = {
      nodes: { added: [], removed: [], modified: [] },
      edges: { added: [], removed: [], modified: [] },
    };
    vi.mocked(diffFlow).mockResolvedValue(emptyDiff as never);

    const { StrictMode } = await import("react");
    render(
      <StrictMode>
        <DiffView flowId="demo" from="c1" to="c2" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No changes\./)).toBeTruthy();
    });

    expect(vi.mocked(diffFlow)).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when close button is clicked", async () => {
    const emptyDiff = {
      nodes: { added: [], removed: [], modified: [] },
      edges: { added: [], removed: [], modified: [] },
    };
    vi.mocked(diffFlow).mockResolvedValue(emptyDiff as never);
    const onClose = vi.fn();

    render(<DiffView flowId="demo" from="c1" to="c2" onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText(/No changes\./)).toBeTruthy();
    });

    const closeBtn = screen.getByLabelText(/close diff/i);
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });
});
