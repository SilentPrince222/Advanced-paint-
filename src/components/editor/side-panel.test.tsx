import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidePanel } from "./side-panel";
import { useFlowStore } from "@/lib/flow-store";
import type { FlowNode } from "@/lib/types";

function stripeNode(selected = true): FlowNode {
  return {
    id: "n-stripe",
    type: "base",
    position: { x: 0, y: 0 },
    selected,
    data: {
      id: "n-stripe",
      type: "action.stripe.charge",
      params: { amount: 100, currency: "usd" },
      isDraftSafe: false,
    },
  };
}

beforeEach(() => {
  useFlowStore.setState({ nodes: [], edges: [] });
});

describe("SidePanel", () => {
  it("shows empty state when no selection", () => {
    render(<SidePanel />);
    expect(screen.getByTestId("side-panel")).toBeInTheDocument();
    expect(screen.getByText("Select a block")).toBeInTheDocument();
  });

  it("shows label and param summary for a selected stripe charge node", () => {
    useFlowStore.setState({ nodes: [stripeNode()], edges: [] });
    render(<SidePanel />);

    expect(screen.getByText("Stripe Charge")).toBeInTheDocument();
    expect(screen.getByText("100 · USD")).toBeInTheDocument();
  });

  it("changing amount input updates store params.amount", () => {
    useFlowStore.setState({ nodes: [stripeNode()], edges: [] });
    render(<SidePanel />);

    fireEvent.change(screen.getByTestId("field-amount"), {
      target: { value: "250" },
    });

    expect(
      useFlowStore.getState().nodes[0]!.data.params.amount,
    ).toBe(250);
  });

  it("B31 — clearing amount must not snap the field back to 0", () => {
    useFlowStore.setState({ nodes: [stripeNode()], edges: [] });
    render(<SidePanel />);

    const input = screen.getByTestId("field-amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });

    expect(input.value).toBe("");
    expect(useFlowStore.getState().nodes[0]!.data.params.amount).not.toBe(0);
  });

  it("B31 — typing a decimal must preserve the trailing dot while editing", () => {
    const node = stripeNode();
    node.data.params = { currency: "usd" };
    useFlowStore.setState({ nodes: [node], edges: [] });
    render(<SidePanel />);

    const input = screen.getByTestId("field-amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2." } });

    expect(input.value).toBe("2.");
  });

  it("B31 — intermediate scientific notation must not poison the store with NaN", () => {
    useFlowStore.setState({ nodes: [stripeNode()], edges: [] });
    render(<SidePanel />);

    fireEvent.change(screen.getByTestId("field-amount"), {
      target: { value: "1e" },
    });

    const amount = useFlowStore.getState().nodes[0]!.data.params.amount;
    expect(Number.isNaN(amount)).toBe(false);
  });

  it("credential select sets credentialRef to demo/stripe-test", () => {
    useFlowStore.setState({ nodes: [stripeNode()], edges: [] });
    render(<SidePanel />);

    fireEvent.change(screen.getByTestId("credential-select"), {
      target: { value: "demo/stripe-test" },
    });

    expect(useFlowStore.getState().nodes[0]!.data.credentialRef).toBe(
      "demo/stripe-test",
    );
  });
});
