# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Notion-style home screen with flow card grid, backed by Aurora, with state-based routing to the existing canvas editor.

**Architecture:** New collection route (`/api/flows`) listing/creating flows from the existing `flow` table. Dashboard is a standalone component; Editor receives `flowId` as a prop instead of hardcoding `DEMO_FLOW_ID`. Zustand store gets an explicit `resetForFlow()` action to prevent state bleed between flows.

**Tech Stack:** Next.js 16 App Router, React 19, Zustand v5, shadcn/ui, Tailwind v4, pg (Aurora PostgreSQL).

## Global Constraints

- No new npm dependencies.
- `"commit"` always double-quoted in SQL.
- `crypto.randomUUID()` for ID generation.
- No localStorage — all data through Aurora.
- Verify after each task: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

---

### Task 1: Migration Infrastructure + `updated_at` Column

**Files:**
- Create: `db/migrations/001-flow-updated-at.sql`
- Create: `scripts/migrate.ts`
- Modify: `package.json` (add `db:migrate` script)

**Interfaces:**
- Consumes: `DATABASE_URL` env var, `pg` Pool.
- Produces: `updated_at` column on `flow` table; `npm run db:migrate` command.

- [ ] **Step 1: Create the migration SQL file**

```sql
-- db/migrations/001-flow-updated-at.sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'flow' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE flow ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;
```

- [ ] **Step 2: Create the migration runner script**

```ts
// scripts/migrate.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const ca = process.env.DATABASE_CA_CERT;
  const dir = join(process.cwd(), "db", "migrations");

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.error(`No migrations directory at ${dir}`);
    process.exitCode = 1;
    return;
  }

  if (files.length === 0) {
    console.log("No migrations to run.");
    return;
  }

  const pool = new Pool({
    connectionString: url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: 1,
  });

  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${file} → ${msg}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

void main();
```

- [ ] **Step 3: Add script to package.json**

Add to `"scripts"`:
```json
"db:migrate": "tsx --env-file=.env scripts/migrate.ts"
```

- [ ] **Step 4: Run the migration against Aurora**

Run: `cd /Users/terobyte/Desktop/Projects/hackathons/h0/Advanced-paint- && npm run db:migrate`

Expected: `✓ 001-flow-updated-at.sql`

- [ ] **Step 5: Verify (typecheck + lint + test + build)**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass (no source changes yet, only new files + migration).

- [ ] **Step 6: Commit**

```bash
git add db/migrations/001-flow-updated-at.sql scripts/migrate.ts package.json
git commit -m "add migration runner + updated_at column"
```

---

### Task 2: Extract `bootstrapFlow` + Refactor `saveFlow`

**Files:**
- Modify: `src/lib/flow-repo.ts:110-154`
- Modify: `src/app/api/flows/[id]/route.ts` (pass name to saveFlow — optional, only if needed)

**Interfaces:**
- Consumes: `PoolClient` (from callers in a transaction).
- Produces: `export async function bootstrapFlow(client: PoolClient, flowId: string, name: string): Promise<void>` — used by Task 3 (POST route) and Task 8 (seed script).

- [ ] **Step 1: Write the failing test**

Create a test that exercises `bootstrapFlow` independently. Add to `src/lib/flow-repo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg at module level (same pattern as existing tests)
const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockClient = {
  query: mockQuery,
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: mockQuery,
} as any;

vi.mock("pg", () => ({
  Pool: vi.fn(() => mockPool),
}));

// Must mock server-only since flow-repo may transitively import db.ts in some paths
vi.mock("server-only", () => ({}));

describe("bootstrapFlow", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("inserts flow and branch with parametrized name", async () => {
    const { bootstrapFlow } = await import("./flow-repo");
    await bootstrapFlow(mockClient as any, "my-flow", "My Custom Name");

    // First call: flow upsert with name param
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO flow"),
      expect.arrayContaining(["my-flow", "My Custom Name", "my-flow-main"]),
    );

    // Second call: branch insert
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO branch"),
      expect.arrayContaining(["my-flow-main", "my-flow"]),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow-repo.test.ts`

Expected: FAIL — `bootstrapFlow` is not exported (or doesn't exist).

- [ ] **Step 3: Extract `bootstrapFlow` and refactor `saveFlow`**

In `src/lib/flow-repo.ts`, add the exported function before `saveFlow`:

```ts
/**
 * Create flow + main branch rows idempotently (single transaction).
 * Caller must be inside a BEGIN'd transaction on the given PoolClient.
 */
export async function bootstrapFlow(
  client: PoolClient,
  flowId: string,
  name: string,
): Promise<void> {
  const branchId = `${flowId}-main`;
  await client.query(
    `INSERT INTO flow (id, name, default_branch_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, default_branch_id = EXCLUDED.default_branch_id`,
    [flowId, name, branchId],
  );
  await client.query(
    `INSERT INTO branch (id, flow_id, name)
     VALUES ($1, $2, 'main')
     ON CONFLICT (id) DO NOTHING`,
    [branchId, flowId],
  );
}
```

Then refactor `saveFlow` signature and body:

```ts
export async function saveFlow(
  pool: Pool,
  flowId: string,
  doc: GraphDocument,
  branchId: string = `${flowId}-main`,
  name: string = flowId,
): Promise<void> {
  const c: PoolClient = await pool.connect();
  try {
    await c.query("BEGIN");

    if (branchId === `${flowId}-main`) {
      await bootstrapFlow(c, flowId, name);
    }

    // Bump updated_at on every save regardless of branch
    await c.query(`UPDATE flow SET updated_at = now() WHERE id = $1`, [flowId]);

    // Delete in FK-safe order: edges → node_view → node
    await c.query(`DELETE FROM edge WHERE branch_id = $1`, [branchId]);
    await c.query(`DELETE FROM node_view WHERE branch_id = $1`, [branchId]);
    await c.query(`DELETE FROM node WHERE branch_id = $1`, [branchId]);

    await insertGraph(c, branchId, doc);

    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/flow-repo.test.ts`

Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass. Existing tests that call `saveFlow` with 3-4 args still work (new `name` param is optional with default).

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow-repo.ts src/lib/flow-repo.test.ts
git commit -m "extract bootstrapFlow, parametrize name in saveFlow"
```

---

### Task 3: Collection Route — `GET /api/flows` + `POST /api/flows`

**Files:**
- Create: `src/app/api/flows/route.ts`
- Create: `src/app/api/flows/route.test.ts`

**Interfaces:**
- Consumes: `bootstrapFlow` from `flow-repo.ts`, `getDb` from `db.ts`.
- Produces: `GET /api/flows` → `FlowSummary[]`; `POST /api/flows` → `FlowSummary` (201).

- [ ] **Step 1: Write the test for GET /api/flows**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/flows/route.test.ts`

Expected: FAIL — `src/app/api/flows/route.ts` does not exist.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/flows/route.ts
import { getDb } from "@/lib/db";
import { bootstrapFlow } from "@/lib/flow-repo";

export async function GET() {
  try {
    const pool = getDb();
    const res = await pool.query(
      `SELECT
         f.id,
         f.name,
         f.updated_at,
         (SELECT count(*)::int FROM node WHERE branch_id = f.default_branch_id) AS node_count
       FROM flow f
       ORDER BY f.updated_at DESC, f.id DESC`,
    );
    const flows = res.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      updatedAt: new Date(r.updated_at as string | Date).toISOString(),
      nodeCount: (r.node_count as number) ?? 0,
    }));
    return Response.json(flows);
  } catch (e) {
    console.error("[GET /api/flows]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 100) {
    return Response.json(
      { error: "name is required (1-100 chars after trim)" },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();

  try {
    const pool = getDb();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await bootstrapFlow(client, id, name);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    return Response.json(
      { id, name, updatedAt: new Date().toISOString(), nodeCount: 0 },
      { status: 201 },
    );
  } catch (e) {
    console.error("[POST /api/flows]", e);
    return Response.json({ error: "internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/api/flows/route.test.ts`

Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/flows/route.ts src/app/api/flows/route.test.ts
git commit -m "add GET/POST /api/flows collection route"
```

---

### Task 4: Zustand Store — `resetForFlow` Action

**Files:**
- Modify: `src/lib/flow-store.ts:43-76` (interface + impl)
- Modify: `src/lib/flow-store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `resetForFlow: () => void` on `FlowState` — used by Task 5 (Editor).

- [ ] **Step 1: Write the failing test**

Add to `src/lib/flow-store.test.ts`:

```ts
describe("resetForFlow", () => {
  it("clears nodes, edges, currentBranchId, resets execLogNonce and running", () => {
    const { useFlowStore } = require("./flow-store");
    const store = useFlowStore.getState();

    // Pollute the store
    useFlowStore.setState({
      nodes: [{ id: "n1", type: "base", position: { x: 0, y: 0 }, data: {} }] as any,
      edges: [{ id: "e1", source: "n1", target: "n2" }] as any,
      currentBranchId: "some-branch",
      execLogNonce: 5,
      running: true,
    });

    useFlowStore.getState().resetForFlow();

    const after = useFlowStore.getState();
    expect(after.nodes).toEqual([]);
    expect(after.edges).toEqual([]);
    expect(after.currentBranchId).toBeUndefined();
    expect(after.execLogNonce).toBe(0);
    expect(after.running).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/flow-store.test.ts`

Expected: FAIL — `resetForFlow` is not a function.

- [ ] **Step 3: Add `resetForFlow` to the store interface and implementation**

In `src/lib/flow-store.ts`, add to `FlowState` interface:

```ts
/** Wipe canvas state for a fresh flow load. Called by Editor on flowId change. */
resetForFlow: () => void;
```

Add to the `create<FlowState>` body:

```ts
resetForFlow: () =>
  set({
    nodes: [],
    edges: [],
    currentBranchId: undefined,
    execLogNonce: 0,
    running: false,
  }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/flow-store.test.ts`

Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flow-store.ts src/lib/flow-store.test.ts
git commit -m "add resetForFlow action to flow store"
```

---

### Task 5: Editor Refactoring — `flowId` Prop + `DEMO_FLOW_ID` Removal

**Files:**
- Modify: `src/components/editor/editor.tsx` (props, all DEMO_FLOW_ID → flowId, back button, resetForFlow call)
- Modify: `src/components/editor/version-panel.tsx` (accept flowId prop, replace 10 DEMO_FLOW_ID refs)
- Modify: `src/components/editor/exec-log-viewer.tsx` (accept flowId prop, replace 1 DEMO_FLOW_ID ref)
- Modify: `src/lib/flow-client.ts` (remove DEMO_FLOW_ID export)
- Modify: `src/components/editor/editor.test.tsx`
- Modify: `src/components/editor/version-panel.test.tsx`
- Modify: `src/components/editor/version-panel.bugs.test.tsx`
- Modify: `src/components/editor/exec-log-viewer.test.tsx`

**Interfaces:**
- Consumes: `resetForFlow` from flow-store (Task 4).
- Produces: `Editor` component with `{ flowId: string; onBack: () => void }` props — used by Task 7 (page.tsx routing).

- [ ] **Step 1: Update `editor.tsx` — add props, resetForFlow, replace DEMO_FLOW_ID, add back button**

Replace the component signature and relevant sections:

```tsx
import { ArrowLeft, Check, Loader2, Play, Save, Workflow, X } from "lucide-react";

interface EditorProps {
  flowId: string;
  onBack: () => void;
}

export function Editor({ flowId, onBack }: EditorProps) {
  // ... existing store selectors ...
  const resetForFlow = useFlowStore((s) => s.resetForFlow);

  // Load on mount + on branch switch
  useEffect(() => {
    let live = true;
    resetForFlow();
    (async () => {
      if (live) setStatus("loading");
      try {
        const d = await fetchFlow(flowId, currentBranchId);
        if (live && d) fromDoc(d);
        if (live) setStatus("idle");
      } catch {
        if (live) setStatus("error");
      }
    })();
    return () => { live = false; };
  }, [flowId, fromDoc, currentBranchId, resetForFlow]);
```

Replace all 4 `DEMO_FLOW_ID` usages with `flowId`:
- Line 44: `fetchFlow(flowId, currentBranchId)`
- Line 68: `saveFlowToServer(flowId, toDoc(), currentBranchId)`
- Line 80: `saveFlowToServer(flowId, toDoc(), currentBranchId)`
- Line 81: `runFlow(flowId, currentBranchId)`

Remove import of `DEMO_FLOW_ID` from `flow-client`.

Add back button in the header before the Workflow icon:

```tsx
<Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
  <ArrowLeft className="h-3.5 w-3.5" />
  My Flows
</Button>
<div className="h-4 border-l border-border" />
```

Pass `flowId` to child components:

```tsx
<VersionPanel flowId={flowId} />
```

- [ ] **Step 2: Update `version-panel.tsx` — accept `flowId` prop, replace all 10 refs**

Add prop:
```tsx
interface VersionPanelProps {
  flowId: string;
}

export function VersionPanel({ flowId }: VersionPanelProps) {
```

Replace each `DEMO_FLOW_ID` with `flowId`:
- Line 37: `listCommits(flowId)`
- Line 38: `listBranches(flowId)`
- Line 49: `listCommits(flowId), listBranches(flowId)`
- Line 64: `` branches.find((b) => b.name === "main" && b.id === `${flowId}-main`) ``
- Line 75: `saveFlowToServer(flowId, doc, currentBranchId)`
- Line 76: `commitFlow(flowId, note, currentBranchId)`
- Line 90: `rollbackFlow(flowId, commitId, currentBranchId)`
- Line 106: `createBranch(flowId, branchName, headCommitId)`
- Line 217: `flowId={flowId}` (already correct — DiffView gets it from prop)

Remove `DEMO_FLOW_ID` import.

- [ ] **Step 3: Update `exec-log-viewer.tsx` — accept `flowId` prop**

```tsx
interface ExecLogViewerProps {
  flowId: string;
}

export function ExecLogViewer({ flowId }: ExecLogViewerProps) {
```

Replace line 17: `listExecLog(flowId)`

Remove `DEMO_FLOW_ID` import.

Update the call site in `version-panel.tsx` where `<ExecLogViewer />` is rendered — pass `flowId`:
```tsx
<ExecLogViewer flowId={flowId} />
```

- [ ] **Step 4: Remove `DEMO_FLOW_ID` from `flow-client.ts`**

Delete line 3: `export const DEMO_FLOW_ID = "demo";`

- [ ] **Step 5: Update test files**

**`editor.test.tsx`:** Update mock (remove `DEMO_FLOW_ID`) and render calls:
```tsx
// Remove from vi.mock:  DEMO_FLOW_ID: "demo",
// Update renders:
render(<Editor flowId="test-flow" onBack={vi.fn()} />);
```

**`version-panel.test.tsx`:** Update renders:
```tsx
render(<VersionPanel flowId="test-flow" />);
```

**`version-panel.bugs.test.tsx`:** Update renders:
```tsx
render(<VersionPanel flowId="test-flow" />);
```

**`exec-log-viewer.test.tsx`:** Update mock and render:
```tsx
// Remove DEMO_FLOW_ID from mock
render(<ExecLogViewer flowId="demo" />);
```

- [ ] **Step 6: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass. No remaining references to `DEMO_FLOW_ID` in source.

- [ ] **Step 7: Verify no remaining DEMO_FLOW_ID references**

Run: `grep -rn "DEMO_FLOW_ID" src/`

Expected: No output.

- [ ] **Step 8: Commit**

```bash
git add src/components/editor/editor.tsx src/components/editor/version-panel.tsx \
  src/components/editor/exec-log-viewer.tsx src/lib/flow-client.ts \
  src/components/editor/editor.test.tsx src/components/editor/version-panel.test.tsx \
  src/components/editor/version-panel.bugs.test.tsx src/components/editor/exec-log-viewer.test.tsx
git commit -m "editor accepts flowId prop, remove DEMO_FLOW_ID"
```

---

### Task 6: Client API Functions + Date Formatting

**Files:**
- Modify: `src/lib/flow-client.ts` (add `FlowSummary`, `listFlows`, `createFlow`)
- Create: `src/lib/format-date.ts`
- Create: `src/lib/format-date.test.ts`

**Interfaces:**
- Consumes: `GET /api/flows`, `POST /api/flows` (Task 3).
- Produces: `listFlows(): Promise<FlowSummary[]>`, `createFlow(name): Promise<FlowSummary>`, `formatRelativeDate(iso): string` — used by Task 7 (Dashboard component).

- [ ] **Step 1: Write the date formatting test**

```ts
// src/lib/format-date.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeDate } from "./format-date";

describe("formatRelativeDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Today at HH:MM' for same-day dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2026-06-23T10:30:00Z");
    expect(result).toMatch(/^Today at /);
  });

  it("returns 'Yesterday' for previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2026-06-22T10:30:00Z");
    expect(result).toBe("Yesterday");
  });

  it("returns 'Mon DD' for same-year dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2026-03-15T10:30:00Z");
    expect(result).toMatch(/Mar 15/);
  });

  it("returns 'Mon DD, YYYY' for different-year dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T15:00:00Z"));
    const result = formatRelativeDate("2025-12-01T10:30:00Z");
    expect(result).toMatch(/Dec 1.*2025/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/format-date.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `formatRelativeDate`**

```ts
// src/lib/format-date.ts
export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/format-date.test.ts`

Expected: PASS

- [ ] **Step 5: Add client functions to `flow-client.ts`**

Append to `src/lib/flow-client.ts`:

```ts
export interface FlowSummary {
  id: string;
  name: string;
  updatedAt: string;
  nodeCount: number;
}

export async function listFlows(): Promise<FlowSummary[]> {
  const res = await fetch("/api/flows");
  if (!res.ok) throw new Error(`listFlows failed: ${res.status}`);
  return res.json() as Promise<FlowSummary[]>;
}

export async function createFlow(name: string): Promise<FlowSummary> {
  const res = await fetch("/api/flows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`createFlow failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<FlowSummary>;
}
```

- [ ] **Step 6: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/format-date.ts src/lib/format-date.test.ts src/lib/flow-client.ts
git commit -m "add listFlows, createFlow client functions + date formatting"
```

---

### Task 7: Dashboard Component + Page Routing

**Files:**
- Create: `src/components/dashboard/dashboard.tsx`
- Modify: `src/app/page.tsx` (replace direct Editor render with screen router)

**Interfaces:**
- Consumes: `listFlows`, `createFlow` from `flow-client.ts` (Task 6); `formatRelativeDate` from `format-date.ts` (Task 6); `Editor` with new props (Task 5).
- Produces: Full working app with dashboard → editor navigation.

- [ ] **Step 1: Create the Dashboard component**

```tsx
// src/components/dashboard/dashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { Plus, Workflow } from "lucide-react";
import { listFlows, createFlow, type FlowSummary } from "@/lib/flow-client";
import { formatRelativeDate } from "@/lib/format-date";

interface DashboardProps {
  onSelectFlow: (id: string) => void;
}

export function Dashboard({ onSelectFlow }: DashboardProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; flows: FlowSummary[] }
  >({ status: "loading" });
  const [creating, setCreating] = useState(false);

  const loadFlows = () => {
    setState({ status: "loading" });
    listFlows()
      .then((flows) => setState({ status: "ready", flows }))
      .catch((e) => setState({ status: "error", message: String(e) }));
  };

  useEffect(() => {
    loadFlows();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const flow = await createFlow("Untitled flow");
      onSelectFlow(flow.id);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <Workflow className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold tracking-tight">
            Visual Automation Builder
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <h2 className="mb-6 text-xl font-semibold">My Flows</h2>

        {state.status === "error" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-destructive">{state.message}</p>
            <button
              onClick={loadFlows}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === "loading" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        )}

        {state.status === "ready" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {/* New Flow card */}
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-8 w-8 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                New flow
              </span>
            </button>

            {/* Flow cards */}
            {state.flows.map((flow) => (
              <button
                key={flow.id}
                onClick={() => onSelectFlow(flow.id)}
                className="flex h-28 flex-col justify-between rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <span className="truncate text-sm font-medium">
                  {flow.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeDate(flow.updatedAt)}
                </span>
              </button>
            ))}

            {/* Empty state hint */}
            {state.flows.length === 0 && (
              <p className="col-span-full pt-2 text-center text-sm text-muted-foreground">
                Start your first flow
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `page.tsx` with screen routing**

```tsx
// src/app/page.tsx
"use client";

import { useState } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { Editor } from "@/components/editor/editor";

type Screen =
  | { view: "dashboard" }
  | { view: "editor"; flowId: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ view: "dashboard" });

  if (screen.view === "editor") {
    return (
      <Editor
        flowId={screen.flowId}
        onBack={() => setScreen({ view: "dashboard" })}
      />
    );
  }

  return (
    <Dashboard
      onSelectFlow={(id) => setScreen({ view: "editor", flowId: id })}
    />
  );
}
```

Remove the `metadata` export from `page.tsx` (it's a client component now — metadata lives in `layout.tsx` which already has it).

- [ ] **Step 3: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`

Verify in browser at http://localhost:3000:
1. Dashboard loads and shows the existing "Demo Flow" card (or error if DB unreachable locally — in that case verify on deployed version later).
2. Clicking "+" creates a new flow and opens the editor.
3. "← My Flows" returns to the dashboard.
4. The new flow card appears in the grid on return.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/dashboard.tsx src/app/page.tsx
git commit -m "add dashboard with flow grid and state routing"
```

---

### Task 8: Seed Script

**Files:**
- Create: `scripts/seed-flows.ts`
- Modify: `package.json` (add `db:seed` script)

**Interfaces:**
- Consumes: `bootstrapFlow`, `saveFlow`, `commitFlow` from `flow-repo.ts` (Task 2); `Pool` from `pg`.
- Produces: 3 pre-seeded flows in Aurora for demo presentation.

- [ ] **Step 1: Create the seed script**

```ts
// scripts/seed-flows.ts
import { Pool, type PoolClient } from "pg";
import type { GraphDocument, GraphNode, GraphEdge, NodeView } from "../src/lib/contract";
import { bootstrapFlow } from "../src/lib/flow-repo";

interface SeedFlow {
  id: string;
  name: string;
  doc: GraphDocument;
}

const SEEDS: SeedFlow[] = [
  {
    id: "seed-stripe",
    name: "Stripe Payment Flow",
    doc: {
      nodes: [
        { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
        { id: "n2", type: "action.stripe.charge", params: { amount: 2500, currency: "usd" }, isDraftSafe: false, credentialRef: "stripe-live" },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 400, y: 200, width: 160, height: 80 },
      ],
    },
  },
  {
    id: "seed-slack",
    name: "Slack Alert Pipeline",
    doc: {
      nodes: [
        { id: "n1", type: "trigger.schedule", params: { cron: "0 9 * * *" }, isDraftSafe: true },
        { id: "n2", type: "condition.if", params: { expression: "status == 'error'" }, isDraftSafe: true },
        { id: "n3", type: "action.slack.post", params: { channel: "#alerts", message: "Error detected" }, isDraftSafe: true },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
        { id: "e2", fromNodeId: "n2", toNodeId: "n3", condition: "true" },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 350, y: 200, width: 160, height: 80 },
        { nodeId: "n3", x: 600, y: 200, width: 160, height: 80 },
      ],
    },
  },
  {
    id: "seed-relay",
    name: "Simple Webhook Relay",
    doc: {
      nodes: [
        { id: "n1", type: "trigger.webhook", params: {}, isDraftSafe: true },
        { id: "n2", type: "action.slack.post", params: { channel: "#general", message: "New event received" }, isDraftSafe: true },
      ],
      edges: [
        { id: "e1", fromNodeId: "n1", toNodeId: "n2" },
      ],
      views: [
        { nodeId: "n1", x: 100, y: 200, width: 160, height: 80 },
        { nodeId: "n2", x: 400, y: 200, width: 160, height: 80 },
      ],
    },
  },
];

async function insertGraph(client: PoolClient, branchId: string, doc: GraphDocument): Promise<void> {
  for (const n of doc.nodes) {
    await client.query(
      `INSERT INTO node (id, branch_id, type, params, credential_ref, is_draft_safe)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [n.id, branchId, n.type, JSON.stringify(n.params ?? {}), n.credentialRef ?? null, n.isDraftSafe],
    );
  }
  for (const e of doc.edges) {
    await client.query(
      `INSERT INTO edge (id, branch_id, from_node_id, to_node_id, condition)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.id, branchId, e.fromNodeId, e.toNodeId, e.condition ?? null],
    );
  }
  for (const v of doc.views) {
    await client.query(
      `INSERT INTO node_view (branch_id, node_id, x, y, width, height, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [branchId, v.nodeId, v.x, v.y, v.width, v.height, null],
    );
  }
}

async function seedOne(pool: Pool, seed: SeedFlow): Promise<void> {
  const exists = await pool.query(`SELECT 1 FROM flow WHERE id = $1`, [seed.id]);
  if (exists.rowCount && exists.rowCount > 0) {
    console.log(`  ⏭ ${seed.name} — already exists`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await bootstrapFlow(client, seed.id, seed.name);

    const branchId = `${seed.id}-main`;

    // Insert live graph
    await insertGraph(client, branchId, seed.doc);

    // Create initial commit
    const commitId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "commit" (id, flow_id, branch_id, parent_id, author_note, graph_snapshot)
       VALUES ($1, $2, $3, NULL, $4, $5::jsonb)`,
      [commitId, seed.id, branchId, "initial setup", JSON.stringify(seed.doc)],
    );

    // Point branch head at the commit
    await client.query(`UPDATE branch SET head_commit_id = $1 WHERE id = $2`, [commitId, branchId]);

    await client.query("COMMIT");
    console.log(`  ✓ ${seed.name}`);
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${seed.name} → ${msg}`);
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const ca = process.env.DATABASE_CA_CERT;
  const pool = new Pool({
    connectionString: url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: 1,
  });

  console.log("Seeding flows...");
  try {
    for (const seed of SEEDS) {
      await seedOne(pool, seed);
    }
  } finally {
    await pool.end();
  }
  console.log("Done.");
}

void main();
```

- [ ] **Step 2: Add script to package.json**

Add to `"scripts"`:
```json
"db:seed": "tsx --env-file=.env scripts/seed-flows.ts"
```

- [ ] **Step 3: Run the seed against Aurora**

Run: `cd /Users/terobyte/Desktop/Projects/hackathons/h0/Advanced-paint- && npm run db:seed`

Expected:
```
Seeding flows...
  ✓ Stripe Payment Flow
  ✓ Slack Alert Pipeline
  ✓ Simple Webhook Relay
Done.
```

- [ ] **Step 4: Run again to verify idempotency**

Run: `npm run db:seed`

Expected:
```
Seeding flows...
  ⏭ Stripe Payment Flow — already exists
  ⏭ Slack Alert Pipeline — already exists
  ⏭ Simple Webhook Relay — already exists
Done.
```

- [ ] **Step 5: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-flows.ts package.json
git commit -m "add seed script with 3 demo flows"
```

---

### Task 9: End-to-End Smoke Test + Deploy

**Files:**
- No new files. This is a verification-only task.

**Interfaces:**
- Consumes: Everything from Tasks 1–8.
- Produces: Working deployed app with dashboard on `advanced-paint.vercel.app`.

- [ ] **Step 1: Run the full local verification suite**

Run: `npx tsc --noEmit && npm run lint && npm run test && npm run build`

Expected: All green.

- [ ] **Step 2: Start dev server and test manually**

Run: `npm run dev`

Test in browser:
1. http://localhost:3000 shows Dashboard with seeded flows + "+" card
2. Click a flow → Editor opens with that flow's graph
3. "← My Flows" → Dashboard (flows still listed, no stale data)
4. "+" → creates new flow → opens empty editor
5. Add nodes, save, go back → card shows in grid with updated timestamp
6. Re-enter the same flow → nodes intact, no bleed from previous flow

- [ ] **Step 3: Push and verify Vercel deployment**

Run: `git push origin main`

After deploy completes, verify https://advanced-paint.vercel.app:
- Dashboard loads (GET /api/flows hits Aurora)
- Seeded flows visible
- Create flow works
- Editor loads flows correctly

- [ ] **Step 4: If migration hasn't run on production Aurora, run it**

The `updated_at` column must exist before the app works. Options:
- SSH/connect to Aurora and run the migration SQL manually via `psql`
- Or: add the migration to the Vercel build command temporarily: `npm run db:migrate && next build`

Verify by hitting GET /api/flows — if it returns without error, the column exists.
