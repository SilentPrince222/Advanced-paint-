import { describe, it, expect } from "vitest";
import { runGraph, mockResponse } from "./interpreter";
import type { GraphDocument } from "@/lib/contract";

// Pure interpreter — no DB, no guard (mirrors graph-serialize-style unit tests).

describe("runGraph", () => {
  it("(a) walks a linear webhook → if → stripe → slack in order with correct kinds + requests", () => {
    const doc: GraphDocument = {
      nodes: [
        { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
        {
          id: "n2",
          type: "condition.if",
          params: { expression: "plan == 'pro'" },
          isDraftSafe: true,
        },
        {
          id: "n3",
          type: "action.stripe.charge",
          params: { amount: 100, currency: "usd" },
          isDraftSafe: false,
        },
        {
          id: "n4",
          type: "action.slack.post",
          params: { channel: "#revenue", message: "New charge" },
          isDraftSafe: true,
        },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
        { id: "e2", fromNodeId: "n2", toNodeId: "n3", condition: "true" },
        { id: "e3", fromNodeId: "n3", toNodeId: "n4" },
      ],
      views: [],
    };

    const trace = runGraph(doc);

    expect(trace.startNodeId).toBe("n1");
    expect(trace.steps.map((s) => s.nodeId)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(trace.steps.map((s) => s.kind)).toEqual([
      "trigger",
      "condition",
      "action",
      "action",
    ]);
    expect(trace.steps[2].request).toEqual({ amount: 100, currency: "usd" });
    expect(trace.steps[3].request).toEqual({
      channel: "#revenue",
      message: "New charge",
    });
    expect(trace.steps[1].request).toEqual({
      expression: "plan == 'pro'",
      result: true,
    });
    expect(trace.steps[0].request).toEqual({});
  });

  it("(b) condition.if follows only the 'true' edge when both true/false labeled, all edges when unlabeled", () => {
    const labeled: GraphDocument = {
      nodes: [
        { id: "t", type: "trigger.webhook", params: {}, isDraftSafe: true },
        {
          id: "c",
          type: "condition.if",
          params: { expression: "x" },
          isDraftSafe: true,
        },
        {
          id: "yes",
          type: "action.slack.post",
          params: { channel: "#yes", message: "y" },
          isDraftSafe: true,
        },
        {
          id: "no",
          type: "action.slack.post",
          params: { channel: "#no", message: "n" },
          isDraftSafe: true,
        },
      ],
      edges: [
        { id: "e1", fromNodeId: "t", toNodeId: "c" },
        { id: "e2", fromNodeId: "c", toNodeId: "yes", condition: "true" },
        { id: "e3", fromNodeId: "c", toNodeId: "no", condition: "false" },
      ],
      views: [],
    };
    const lt = runGraph(labeled);
    expect(lt.steps.map((s) => s.nodeId)).toEqual(["t", "c", "yes"]);

    const unlabeled: GraphDocument = {
      ...labeled,
      edges: [
        { id: "e1", fromNodeId: "t", toNodeId: "c" },
        { id: "e2", fromNodeId: "c", toNodeId: "yes" },
        { id: "e3", fromNodeId: "c", toNodeId: "no" },
      ],
    };
    const ut = runGraph(unlabeled);
    expect(ut.steps.map((s) => s.nodeId).sort()).toEqual([
      "c",
      "no",
      "t",
      "yes",
    ]);
  });

  it("(c) omits a disconnected node from steps", () => {
    const doc: GraphDocument = {
      nodes: [
        { id: "t", type: "trigger.webhook", params: {}, isDraftSafe: true },
        {
          id: "a",
          type: "action.slack.post",
          params: { channel: "#a", message: "a" },
          isDraftSafe: true,
        },
        {
          id: "orphan",
          type: "action.slack.post",
          params: { channel: "#o", message: "o" },
          isDraftSafe: true,
        },
      ],
      edges: [{ id: "e1", fromNodeId: "t", toNodeId: "a" }],
      views: [],
    };
    const trace = runGraph(doc);
    expect(trace.steps.map((s) => s.nodeId)).toEqual(["t", "a"]);
    expect(trace.steps.find((s) => s.nodeId === "orphan")).toBeUndefined();
  });

  it("(d) terminates on a cycle A → B → A, visiting each node once", () => {
    const doc: GraphDocument = {
      nodes: [
        { id: "A", type: "trigger.webhook", params: {}, isDraftSafe: true },
        {
          id: "B",
          type: "action.slack.post",
          params: { channel: "#b", message: "b" },
          isDraftSafe: true,
        },
      ],
      edges: [
        { id: "e1", fromNodeId: "A", toNodeId: "B" },
        { id: "e2", fromNodeId: "B", toNodeId: "A" },
      ],
      views: [],
    };
    const trace = runGraph(doc);
    expect(trace.steps.map((s) => s.nodeId)).toEqual(["A", "B"]);
  });

  it("(e) returns an empty trace when there is no trigger node", () => {
    const doc: GraphDocument = {
      nodes: [
        {
          id: "a",
          type: "action.slack.post",
          params: { channel: "#a", message: "a" },
          isDraftSafe: true,
        },
      ],
      edges: [],
      views: [],
    };
    expect(runGraph(doc)).toEqual({ startNodeId: null, steps: [] });
  });
});

describe("mockResponse", () => {
  it("(g) stripe → mock_ch_ prefix + mock true, slack → ok + mock", () => {
    const stripe = mockResponse(
      "action.stripe.charge",
      "abcd1234-ef56-7890-1234-567890abcdef",
    );
    expect(stripe.mock).toBe(true);
    expect(typeof stripe.chargeId).toBe("string");
    expect((stripe.chargeId as string).startsWith("mock_ch_")).toBe(true);

    const slack = mockResponse("action.slack.post", "exec-id-xyz");
    expect(slack.ok).toBe(true);
    expect(slack.mock).toBe(true);
    expect(slack.ts).toBe("exec-id-xyz");
  });
});
