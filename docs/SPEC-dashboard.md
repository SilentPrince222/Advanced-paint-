# Dashboard Spec v3 — Notion-style Flow Home Screen

## 1. Goal

Add a home screen (Dashboard) before the canvas editor where users see all saved flows as a card grid, can create new flows, and open any flow in the editor.

---

## 2. Data Model

### 2.1 Migration: `updated_at` column

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

**Runner:** New `scripts/migrate.ts` that reads `db/migrations/*.sql` sorted lexicographically, executes each in its own transaction. Add `"db:migrate": "tsx --env-file=.env scripts/migrate.ts"` to package.json.

### 2.2 `updated_at` bump semantics

`updated_at` is set to `now()` inside `saveFlow()` **unconditionally** (on every save, regardless of branch). The bump happens in a single statement inside the existing transaction:

```sql
UPDATE flow SET updated_at = now() WHERE id = $1
```

This is the **only** place `updated_at` is written after initial creation. Not in the `bootstrapFlow` upsert (which sets it via the column default on INSERT only), not in commit, not in rollback.

---

## 3. Backend

### 3.1 Extract `bootstrapFlow` (transactional, exported)

Extract from `saveFlow()` into its own exported function in `flow-repo.ts`:

```ts
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

**Key difference from v2 spec:** The flow upsert uses `DO UPDATE SET name = ..., default_branch_id = ...` (not `DO NOTHING`). This allows re-pointing `default_branch_id` if the bootstrap is called on an existing flow (e.g. `saveFlow` on a flow that was created via POST but never had default_branch_id set correctly). Fixes B47.

**`saveFlow` changes:**

```ts
export async function saveFlow(
  pool: Pool,
  flowId: string,
  doc: GraphDocument,
  branchId: string = `${flowId}-main`,
  name: string = flowId,
): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    if (branchId === `${flowId}-main`) {
      await bootstrapFlow(c, flowId, name);
    }

    // Always bump updated_at (even for non-main branches)
    await c.query(`UPDATE flow SET updated_at = now() WHERE id = $1`, [flowId]);

    // ... rest unchanged (delete + insertGraph + COMMIT)
  }
}
```

### 3.2 `POST /api/flows` — Create flow

**File:** `src/app/api/flows/route.ts` (new collection route)

**Request:**
```json
{ "name": "My New Flow" }
```

**Validation:** `name` must be a non-empty string after trim, max 100 chars. Otherwise 400:
```json
{ "error": "name is required (1-100 chars after trim)" }
```

**Behavior (single transaction on one PoolClient):**
1. Generate `id = crypto.randomUUID()`.
2. `bootstrapFlow(client, id, name.trim())`.
3. COMMIT.
4. No initial commit (matches existing pattern — "demo" flow also starts at 0 commits until first save+commit or run).
5. No nodes/edges/views inserted (the live tables are simply empty for this branch).

**Response:** `201 Created`
```json
{
  "id": "uuid-here",
  "name": "My New Flow",
  "updatedAt": "2026-06-23T10:15:00.000Z",
  "nodeCount": 0
}
```

Same shape as GET /api/flows items → client can optimistically prepend without refetch.

**Double-click prevention:** Frontend-only — the "+" button is disabled while the POST is in-flight (state: `creating: boolean`). No server-side idempotency key (each request gets a fresh UUID — two requests = two flows, both valid).

### 3.3 `GET /api/flows` — List flows

**File:** same `src/app/api/flows/route.ts`

**Response:** `200 OK`
```json
[
  {
    "id": "demo",
    "name": "Demo Flow",
    "updatedAt": "2026-06-23T10:15:00.000Z",
    "nodeCount": 4
  }
]
```

**SQL (single query, no join):**
```sql
SELECT
  f.id,
  f.name,
  f.updated_at,
  (SELECT count(*)::int FROM node WHERE branch_id = f.default_branch_id) AS node_count
FROM flow f
ORDER BY f.updated_at DESC, f.id DESC
```

- Tiebreaker `f.id DESC` → deterministic order for same-timestamp rows. Fixes B44.
- `count(*)::int` → number, not pg bigint string.
- No pagination (demo scale, <100 flows).

### 3.4 Guard: PUT /api/flows/[id] on non-existent flow

Currently, PUT to `/api/flows/nonexistent` calls `saveFlow("nonexistent", doc)` which silently creates a flow named "Demo Flow" (critical #1). After the refactor:

- `saveFlow` no longer hardcodes a name — it uses the `name` param (default: flowId).
- BUT: the PUT route for an unknown flowId will **still** auto-create via `bootstrapFlow`. This is acceptable (existing behavior), but the flow name will be the flowId string (e.g., "nonexistent"), which is ugly but non-dangerous.
- **Decision:** Leave as-is. A flow opened via direct URL to a non-existent ID gets auto-created with id-as-name. This is the demo's existing contract. Fixing B42 fully (reject PUT to unknown flow) would break backward compat with the single-flow demo path. Documented but not changed.

---

## 4. Frontend

### 4.1 Routing

State in `page.tsx`:

```tsx
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

**No `key={flowId}` on Editor** — see §4.3 for why not.

**Browser back:** Not handled. `onBack` is the only way out of the editor. Unsaved work is silently lost if the user navigates away via browser chrome. B43 is acknowledged as a known limitation; an `onbeforeunload` handler would catch browser-nav but not our in-app `onBack`. Adding a "discard unsaved?" confirm dialog to `onBack` is a stretch goal, not MVP.

### 4.2 Editor Refactoring — Zustand Store Reset

**The problem (B41):** `useFlowStore` is created at module level (`create<FlowState>(...)`) — it's a true singleton. `<Editor key={flowId}>` remounts the component and re-runs hooks, but the **store itself** retains its state (nodes, edges, currentBranchId from the previous flow). Selectors like `useFlowStore(s => s.nodes)` return stale nodes until the fetch effect overwrites them.

**The fix:** Add a `resetForFlow` action to the store:

```ts
// in flow-store.ts
resetForFlow: () => set({
  nodes: [],
  edges: [],
  currentBranchId: undefined,
  execLogNonce: 0,
  running: false,
}),
```

Editor calls `resetForFlow()` synchronously at the top of its mount effect (before fetching):

```ts
useEffect(() => {
  resetForFlow();
  // ... then fetch
}, [flowId, resetForFlow]);
```

This ensures the canvas is blank while the new flow loads (shows loading state, not stale graph from previous flow).

**Why not `key={flowId}`:** It would cause a full unmount/remount of ReactFlow, losing viewport zoom/pan state during development. More importantly, it does NOT reset the Zustand singleton — the selector hooks re-subscribe but still see old state until overwritten.

### 4.3 Editor Props & `DEMO_FLOW_ID` Removal

**New props:**
```ts
interface EditorProps {
  flowId: string;
  onBack: () => void;
}
```

**Actual call sites to update (verified by grep):**

| File | DEMO_FLOW_ID occurrences | Fix |
|------|--------------------------|-----|
| `editor.tsx:12,44,68,80,81` | 4 calls (fetchFlow, saveFlowToServer×2, runFlow) + import | Replace with `props.flowId` |
| `version-panel.tsx:13,37,38,49,64,75,76,90,106,217` | 10 calls (listCommits×2, listBranches×2, saveFlowToServer, commitFlow, rollbackFlow, createBranch, branch-id template literal, DiffView prop) + import | Accept `flowId: string` prop from Editor |
| `exec-log-viewer.tsx:6,17` | 1 call (listExecLog) + import | Accept `flowId: string` prop from Editor |
| `diff-view.tsx` | Already accepts `flowId` as prop | No changes needed |
| `flow-client.ts:3` | Export declaration | Remove the constant entirely |

**Tests to update:**

| Test file | What changes |
|-----------|--------------|
| `editor.test.tsx:37,61,75` | `<Editor />` → `<Editor flowId="test-flow" onBack={vi.fn()} />` |
| `version-panel.test.tsx:111,120,142,165,178,197,217` | `<VersionPanel />` → `<VersionPanel flowId="test-flow" />` |
| `exec-log-viewer.test.tsx` | mock still uses `DEMO_FLOW_ID: "demo"` in vi.mock — update mock + pass `flowId="demo"` prop |
| `version-panel.bugs.test.tsx` | Same as version-panel.test.tsx |

### 4.4 Header: "← My Flows" Button

In `editor.tsx` header, before the Workflow icon + title:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={onBack}
  className="gap-1"
>
  <ArrowLeft className="h-3.5 w-3.5" />
  My Flows
</Button>
```

Separated from the title by a vertical divider (`border-l border-border h-4`).

### 4.5 Dashboard Component

**File:** `src/components/dashboard/dashboard.tsx`

**Props:**
```ts
interface DashboardProps {
  onSelectFlow: (id: string) => void;
}
```

**State machine:**
```ts
type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; flows: FlowSummary[] }

// separate from data state:
// creating: boolean (for the + button in-flight guard)
```

**Fetch:** `useEffect` on mount (empty deps). Since Dashboard unmounts when entering editor, it refetches on every return. No stale cache problem.

**Retry:** On error state, show "Failed to load flows" + a "Retry" button. The retry button sets state back to `loading` and re-runs the fetch. Implementation: extract the fetch into a `loadFlows()` function called by both the effect and the button's onClick.

**Layout:**
```
max-w-4xl mx-auto px-6 py-12
  header: icon + title + "My Flows" subtitle
  grid: grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)) gap-4
    [+ card] [flow card] [flow card] ...
```

**Loading state:** 3 skeleton cards — `animate-pulse bg-muted rounded-lg h-28`.

**Empty state (0 flows, not loading):** Only "+" card shown. Below it: `<p class="text-sm text-muted-foreground">Start your first flow</p>`.

**"New Flow" card:**
- `border-2 border-dashed border-muted-foreground/30 rounded-lg`
- `hover:border-primary/50 transition-colors cursor-pointer`
- `disabled:opacity-50 disabled:cursor-not-allowed` when `creating === true`
- Contents: `<Plus className="h-8 w-8" />` + text "New flow"
- onClick: set `creating=true` → POST /api/flows with name "Untitled flow" → on success: optimistically call `onSelectFlow(newId)` → on failure: set `creating=false`, show error.

**Flow card:**
- `bg-card border border-border rounded-lg p-4 cursor-pointer`
- `hover:border-primary/50 transition-colors`
- Line 1: flow name — `text-sm font-medium truncate` (CSS `text-overflow: ellipsis`; no tooltip — minor scope cut)
- Line 2: relative date — `text-xs text-muted-foreground`
- onClick: `onSelectFlow(flow.id)`

### 4.6 Date Formatting

Utility function `formatRelativeDate(iso: string): string` in `src/lib/format-date.ts`:

```ts
export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
```

Uses `toLocaleDateString` / `toLocaleTimeString` (browser locale) — not Intl.RelativeTimeFormat. No new deps. Day boundaries are computed from **local** time (via `new Date()` comparison), which matches user expectation for "Today/Yesterday".

---

## 5. Client API Functions

Add to `flow-client.ts`:

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

---

## 6. Seed Script

**File:** `scripts/seed-flows.ts`
**Command:** `"db:seed": "tsx --env-file=.env scripts/seed-flows.ts"` in package.json.

**Approach:** Import `bootstrapFlow`, `saveFlow`, `commitFlow` from `flow-repo.ts` (requires them to be exported; `bootstrapFlow` is extracted in §3.1).

**Problem:** `flow-repo.ts` uses type-only imports from `pg` and is designed to receive a Pool from outside. The seed script creates its own Pool (like `init-db.ts`) and calls repo functions directly.

**Problem:** `bootstrapFlow` takes a `PoolClient` (inside a transaction), not a `Pool`. The seed script must `pool.connect()` → `BEGIN` → `bootstrapFlow(client, ...)` → ... → `COMMIT` per flow.

**Idempotency:** Check `SELECT 1 FROM flow WHERE id = $1` before bootstrapping each flow. If exists → skip with log message. This avoids B40 (repeated runs creating duplicate commits).

**Seed data (3 flows):**

1. **"Stripe Payment Flow"** (`id: "seed-stripe"`)
   - Nodes: trigger.webhook → action.stripe.charge
   - Params: `{} → {amount: 2500, currency: "usd"}`
   - credentialRef on charge node: `"stripe-live"`
   - One commit, authorNote: "initial setup"

2. **"Slack Alert Pipeline"** (`id: "seed-slack"`)
   - Nodes: trigger.schedule → condition.if → action.slack.post
   - Params: `{cron:"0 9 * * *"} → {expression:"status == 'error'"} → {channel:"#alerts", message:"Error detected"}`
   - One commit, authorNote: "initial setup"

3. **"Simple Webhook Relay"** (`id: "seed-relay"`)
   - Nodes: trigger.webhook → action.slack.post
   - Params: `{} → {channel:"#general", message:"New event received"}`
   - One commit, authorNote: "initial setup"

Each flow is seeded atomically: `BEGIN` → bootstrapFlow → save nodes/edges/views → commit (insertGraph + commit row + branch head update) → `COMMIT`. If any step fails, that flow's transaction is rolled back, logged, and the script continues.

---

## 7. Constraints (hard rules)

- No localStorage.
- No React Router / URL changes.
- No new npm dependencies. Uses: `crypto.randomUUID()` (Node built-in, also available in modern browsers via Web Crypto), `toLocaleDateString` / `toLocaleTimeString`.
- `"commit"` is always double-quoted in SQL (reserved word).
- Click-to-open only — no hover menus, right-click, rename, delete.
- Store reset is explicit (`resetForFlow()`), not implicit via React key.

---

## 8. Error Handling

| Scenario | Frontend behavior |
|----------|------------------|
| GET /api/flows fails | Show error state with "Retry" button that re-fetches |
| POST /api/flows fails | Re-enable "+" button, show inline error text below the card |
| Editor loads non-existent flow | Existing behavior: shows empty canvas (auto-created via saveFlow on first save) |

---

## 9. Non-goals (explicitly excluded)

- Flow deletion
- Flow renaming (anywhere)
- Search/filter
- Folders/workspaces
- URL routing / deep links / browser back handling
- "Discard unsaved?" confirmation dialog
- Drag-to-reorder
- Thumbnails/card previews
- Pagination
- nodeCount displayed on cards (fetched for future use, not rendered)
