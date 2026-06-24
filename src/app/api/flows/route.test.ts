// src/app/api/flows/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockClient = { query: mockQuery, release: vi.fn() };
const mockPool = {
  query: mockQuery,
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock("@/lib/db", () => ({ getDb: () => mockPool }));
vi.mock("server-only", () => ({}));

describe("GET /api/flows", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns flows sorted by updated_at desc with node_count", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "f1", name: "Flow One", updated_at: "2026-06-23T10:00:00Z", node_count: 3 },
        { id: "f2", name: "Flow Two", updated_at: "2026-06-22T10:00:00Z", node_count: 0 },
      ],
    });

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      { id: "f1", name: "Flow One", updatedAt: "2026-06-23T10:00:00.000Z", nodeCount: 3 },
      { id: "f2", name: "Flow Two", updatedAt: "2026-06-22T10:00:00.000Z", nodeCount: 0 },
    ]);
  });
});

describe("POST /api/flows", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClient.query.mockReset();
  });

  it("creates a flow and returns 201 with FlowSummary shape", async () => {
    // BEGIN, bootstrapFlow (2 queries), COMMIT
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // INSERT flow
      .mockResolvedValueOnce({}) // INSERT branch
      .mockResolvedValueOnce({}); // COMMIT

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Flow" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe("Test Flow");
    expect(body.nodeCount).toBe(0);
    expect(body.id).toBeDefined();
    expect(body.updatedAt).toBeDefined();
  });

  it("rejects empty name with 400", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects name > 100 chars with 400", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(101) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
