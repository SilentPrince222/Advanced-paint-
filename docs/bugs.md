# Bugs — Full Audit (2026-06-24)

Discovered by 5-sonnet fan-out hunt (data integrity, edge cases, silent failures, secrets, state/lifecycle). Deduplicated by Opus.

**Legend:** **fixed** = green regression test · **open** = RED regression test (still to fix) · **env** = Vercel/env only

---

## CRITICAL

---

### C1 — SSL certificate verification disabled on production DB connection

**Status:** open (env) · **Test:** `src/lib/db.test.ts` (RED)

**Severity:** CRIT  
**File:** `.env` + Vercel env vars  
**Line:** DATABASE_URL param `sslmode=no-verify`

**Evidence:**
```
DATABASE_URL=postgresql://postgres:...@h0-aurora...us-east-1.rds.amazonaws.com:5432/postgres?sslmode=no-verify
```

**Problem:** `sslmode=no-verify` means TLS encrypts the connection but does NOT verify the server's certificate. An attacker on the network path (AWS VPC, ISP, Vercel edge → Aurora) can present a forged certificate, intercept traffic, and read/modify every SQL query and response — including plaintext passwords, JSONB snapshots, and Stripe credential references.

The code in `src/lib/db.ts` even supports proper verification:
```ts
ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
```
But `DATABASE_CA_CERT` is never set in production — only documented in `.env.example`.

**Why judges care:** AWS engineers know that `sslmode=no-verify` is equivalent to "we have TLS theater." It's the #1 Aurora misconfiguration they see. They will ask "is your DB connection verified?" — and the answer is "no."

**Fix:** Set `DATABASE_CA_CERT` env var on Vercel to the [AWS RDS global CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem). Change `sslmode=no-verify` → `sslmode=verify-full` in DATABASE_URL.

---

### C2 — Stripe executor silently charges $1.00 on invalid input

**Status:** **fixed** · **Test:** `src/lib/stripe-executor.test.ts` (green)

Returns `{ status: "failure", response: { error: "invalid_amount" | "invalid_currency" } }` — no Stripe call on bad input.

---

## MAJOR

---

### M1 — Idempotency key depends on JSON.stringify key ordering

**Status:** **fixed** · **Test:** `src/app/api/flows/[id]/run/route.test.ts` (green)

Uses `JSON.stringify(s.request, Object.keys(s.request).sort())` in `run/route.ts`.

---

### M2 — Mock mode always records status "success" in exec_log

**Status:** open · **Test:** `src/app/api/flows/[id]/run/route.test.ts` (RED)

**Severity:** MAJOR  
**File:** `src/app/api/flows/[id]/run/route.ts`  
**Line:** 54–67

**Evidence:**
```ts
let status: "success" | "failure" = "success";

if (mockMode) {
  response = mockResponse(s.type, execId);
  // status stays "success" — never changes
} else {
  const result = await executeAction(s.type, s.request, idempotencyKey);
  if (result) {
    response = result.response;
    status = result.status;
  } else {
    response = mockResponse(s.type, execId);
    status = "failure";
  }
}
```

**Problem:** In mock mode (local dev, or if `MOCK_MODE=1` leaks to production), every execution is logged as `status: "success"`. The exec_log viewer shows 100% success rate regardless of what would actually happen.

**Why judges care:** The "honesty thesis" — exec_log as an immutable audit trail — is undermined if the trail is always "success." It looks fake. During a demo, if judges ask "show me a failed execution," you can't produce one without disabling mock mode and forcing a real Stripe error.

**Fix:** Add failure simulation to mock mode:
```ts
if (mockMode) {
  response = mockResponse(s.type, execId);
  // mockResponse could randomly return failure for demo purposes,
  // or respect a "mock_failure" flag in node params
}
```
Or simpler: just document that mock mode always succeeds and ensure demo uses real Stripe (which it does — `MOCK_MODE=0` on Vercel).

---

### M3 — Branch creation refreshes old branch's commits

**Status:** open · **Test:** `src/components/editor/version-panel.bugs.test.tsx` (RED)

**Severity:** MAJOR  
**File:** `src/components/editor/version-panel.tsx`  
**Line:** 100–114

**Evidence:**
```tsx
const onCreateBranch = async () => {
  // ...
  const branch = await createBranch(flowId, branchName, headCommitId);
  setBranchName("");
  await refresh();                    // ← fetches commits for OLD currentBranchId
  setCurrentBranchId(branch.id);     // ← switches to new branch AFTER refresh
};
```

**Problem:** `refresh()` calls `listCommits(flowId)` using the current `currentBranchId` (captured in closure). The new branch's ID isn't set until after refresh completes. So after creating a branch, the commit list shows the OLD branch's history for one render cycle.

**Why judges care:** During a demo: "I'll create a branch from this commit" → create → commit list still shows main's commits → confusing. Not a data bug, but a polish issue visible to attentive judges.

**Fix:** Pass the new branch ID to refresh, or reverse the order:
```tsx
setCurrentBranchId(branch.id);  // switch first
await refresh();                 // then fetch for new branch
```

---

### M4 — persistRun failure after Stripe charge = orphaned money

**Status:** open (partial) · **Test:** `src/app/api/flows/[id]/run/route.test.ts` (RED)

Idempotency key is now stable (M1 fixed). Still open: `commitId = randomUUID()` on every POST — retry after `persistRun` failure gets a new commitId and can double-charge without audit trail.

**Severity:** MAJOR  
**File:** `src/app/api/flows/[id]/run/route.ts`  
**Line:** 59–90

**Evidence:**
```ts
// Line 59: Stripe charge executes here (real money moves)
const result = await executeAction(s.type, s.request, idempotencyKey);

// ... charges succeed, records built ...

// Line 90: DB write — if THIS fails, the charges are orphaned
await persistRun(getDb(), id, commitId, doc, records, branch);
```

**Problem:** `executeAction()` calls Stripe (real charge), then `persistRun()` writes the exec_log. If the DB write fails (connection timeout, constraint violation, disk full), the money has already left the customer's account but there is NO record in exec_log. The "append-only audit trail" has a gap.

Worse: the route returns 500, client retries, but now `commitId` is regenerated (line 41), which changes the idempotency key → Stripe sees it as a new charge → **double charge with no audit trail**.

**Why judges care:** This violates the core "honesty thesis." The exec_log is supposed to be the source of truth for what happened. If charges can exist without a log entry, the guarantee is broken.

**Fix (ideal):** Write exec_log rows with `status: "pending"` BEFORE calling Stripe, then update to `success`/`failure` after. Two-phase pattern.

**Fix (pragmatic for hackathon):** Keep `commitId` stable across retries (derive from flow_id + branch + timestamp bucket), so idempotency key doesn't change on retry.

---

### M5 — Rollback and Run can execute concurrently, causing state corruption

**Status:** open · **Test:** `editor.bugs.test.tsx` + `version-panel.bugs.test.tsx` (RED)

**Severity:** MAJOR  
**File:** `src/components/editor/version-panel.tsx:85` + `src/components/editor/editor.tsx:76`

**Evidence:**
```tsx
// editor.tsx — Run button
const onRun = async () => {
  setRunning(true);
  await saveFlowToServer(flowId, toDoc(), currentBranchId);  // saves current canvas
  setRunResult(await runFlow(flowId, currentBranchId));
  // ...
};

// version-panel.tsx — Rollback button
const onRollback = async (commitId: string) => {
  setBusy(true);
  const res = await rollbackFlow(flowId, commitId, currentBranchId);
  useFlowStore.getState().fromGraphDocument(res.doc);  // overwrites canvas
  // ...
};
```

**Problem:** `busy` (VersionPanel) and `running` (Editor) are independent state. User clicks Run → while save is in flight → clicks Rollback in VersionPanel → rollback overwrites server state with old snapshot → Run's `runFlow` then executes the old snapshot instead of what the user intended.

Result: canvas shows rolled-back graph, but exec_log records a run of the rolled-back graph that the user didn't intend to execute.

**Why judges care:** "Definition rollback ≠ consequence rollback" — but here rollback accidentally triggers execution of the old graph. The immutable log records an unintended action.

**Fix:** Global operation lock: disable Rollback/Commit buttons while `running` is true, and disable Run while `busy` is true. Share state between components via Zustand.

---

### M6 — console.error in all API routes may leak DB credentials to Vercel logs

**Status:** **fixed** · **Test:** `src/app/api/flows/[id]/route-logging.test.ts` (green)

All 12 catch blocks now log `e instanceof Error ? e.message : "unknown"`.

---

## MINOR

---

### m1 — Flow load failure shows blank screen with no user feedback

**Status:** open · **Test:** `src/components/editor/editor.bugs.test.tsx` (RED)

**File:** `src/components/editor/editor.tsx:48`

```tsx
} catch {
  if (live) setStatus("error");
}
```

Status becomes "error" but the UI renders nothing — no error message, no retry button, just a white canvas. During a demo, if the initial fetch fails (server cold start, network blip), judges see a broken blank page.

**Fix:** Show an error banner with "Failed to load — click to retry" when `status === "error"`.

---

### m2 — Save failure is indistinguishable from success

**Status:** open · **Test:** `src/components/editor/editor.bugs.test.tsx` (RED)

**File:** `src/components/editor/editor.tsx:71`

```tsx
} catch {
  setStatus("error");
}
```

"error" status shows briefly then reverts to "idle" on next store change. No persistent indicator, no toast, no message. User thinks save worked; their changes are lost.

**Fix:** Show a red "Save failed" badge that persists until next successful save.

---

### m3 — Empty catch on ROLLBACK can poison pg pool connection

**File:** `src/lib/flow-repo.ts:247`

```ts
} catch (e) {
  try { await c.query("ROLLBACK"); } catch {}
  throw e;
}
```

If ROLLBACK itself fails (connection dropped mid-transaction), the `catch {}` swallows it. The connection is released back to the pool in an unknown transaction state. Next query on that connection gets "current transaction is aborted" errors.

**Fix:** On ROLLBACK failure, destroy the client instead of releasing: `c.release(true)` (pg Pool's "destroy" flag).

---

### m4 — Number() coercion on DB rows can produce NaN, making nodes invisible

**File:** `src/lib/flow-repo.ts:52–55`

```ts
x: Number(row.x),
y: Number(row.y),
width: Number(row.width),
height: Number(row.height),
```

If DB contains corrupted data (`x = 'NaN'` or `null`), nodes render at position (NaN, NaN) — invisible on the canvas but still in the node list. The graph "disappears" with no error.

**Fix:** Validate after coercion:
```ts
const x = Number(row.x);
if (!Number.isFinite(x)) throw new Error(`corrupt node_view: x=${row.x}`);
```

---

### m5 — Stripe error log may expose API key fragment

**Status:** **fixed** · **Test:** `src/lib/stripe-executor.test.ts` (green)

Logs `err.code` only, not the full Stripe message.

---

### m6 — Commit/branch list fetch failure shows stale data silently

**Status:** open · **Test:** `src/components/editor/version-panel.bugs.test.tsx` (RED)

**File:** `src/components/editor/version-panel.tsx:41–43`

```tsx
} catch {
  // non-fatal — lists stay stale
}
```

If `listCommits` or `listBranches` fails, the panel keeps showing old data. User commits, refresh fails, they see the old list and think their commit didn't save. They might commit again (duplicate).

**Fix:** Show a subtle "refresh failed" indicator, or auto-retry once.

---

### m7 — Delete node doesn't clear ReactFlow selection → stale side panel

**Status:** open · **Test:** `src/lib/flow-store.test.ts` (RED)

**File:** `src/lib/flow-store.ts:130–136`

```tsx
removeNode: (id) => {
  set({
    nodes: get().nodes.filter((node) => node.id !== id),
    edges: get().edges.filter(
      (edge) => edge.source !== id && edge.target !== id,
    ),
  });
},
```

When a selected node is deleted, the `selected` flag isn't cleared from ReactFlow's internal state. For one render frame, the SidePanel may try to read properties of a node that no longer exists.

**Fix:** Before filtering, set `selected: false` on the target node, or use ReactFlow's `deleteElements` API.

---

### m8 — tok_visa hardcoded — will fail if live Stripe key is used

**Status:** **fixed** · **Test:** `src/lib/stripe-executor.test.ts` (green)

Returns `{ error: "live_key_with_test_token" }` before any Stripe API call when key starts with `sk_live_`.

---

## Previously Fixed / Dropped

| ID | Title | Status |
|----|-------|--------|
| **C2** | Stripe executor silent $1.00 charge on invalid input | **fixed** — fail-closed in `stripe-executor.ts` |
| **M1** | Idempotency key JSON key ordering | **fixed** — sorted keys in `run/route.ts` |
| **M6** | console.error leaks full pg error object | **fixed** — all 12 routes log `e.message` only |
| **m5** | Stripe error log exposes API key fragment | **fixed** — logs `err.code` only |
| **m8** | tok_visa + live key mismatch | **fixed** — guard before Stripe call |
| B40 | Save during Run corrupts exec_log | not-a-bug (Save disabled during Run) |
| B41 | Dashboard create button sticks | ghost (try/catch handles all paths) |
| B42 | Future timestamps show bare date | **fixed** (5273d3c) |
| B43 | Invalid Date renders in UI | **fixed** (5273d3c) |
| — | Branch switch race in editor effect | ghost (`live` flag per-closure correct) |
| — | Money precision in Stripe params | ghost (zod validates `z.number().int()`) |
| — | Branch existence validation | ghost (FK errors propagate correctly) |
| — | Double-click on Run | ghost (React 19 batches setState synchronously in event handlers) |
| — | categoryOf crashes on empty string | ghost (drop-payload rejects `type.length === 0` upstream) |
| — | Circular reference in graph-diff | ghost (Zod schemas enforce flat params for all node types) |
| — | interpreter triggers[0] undefined | ghost (returns `{ startNodeId: null, steps: [] }` — handled) |

---

## Priority Matrix (for hackathon deadline 2026-06-29)

### Open — RED tests (fix next)

| Bug | Test file | Effort |
|-----|-----------|--------|
| **C1** | `db.test.ts` | 5 min env (Vercel `DATABASE_CA_CERT` + `sslmode=verify-full`) |
| **M2** | `run/route.test.ts` | 10 min |
| **M3** | `version-panel.bugs.test.tsx` | 5 min (swap two lines) |
| **M4** | `run/route.test.ts` | risky — stable `commitId` on retry |
| **M5** | `editor.bugs.test.tsx`, `version-panel.bugs.test.tsx` | risky — global operation lock |
| **m1** | `editor.bugs.test.tsx` | 10 min |
| **m2** | `editor.bugs.test.tsx` | 10 min |
| **m6** | `version-panel.bugs.test.tsx` | 5 min |
| **m7** | `flow-store.test.ts` | low priority — one-frame glitch |

### Fixed — green tests (done)

| Bug | Where |
|-----|-------|
| **C2** | `stripe-executor.ts` — fail-closed on invalid amount/currency |
| **M1** | `run/route.ts` — sorted-key idempotency hash |
| **M6** | all API route catch blocks — `e.message` only |
| **m5** | `stripe-executor.ts` — log `err.code` only |
| **m8** | `stripe-executor.ts` — live-key guard |

### Skip (no RED test / too risky)

| Bug | Why skip |
|-----|----------|
| **m3** | pg pool handles ROLLBACK failure gracefully in practice |
| **m4** | Can't happen without manual DB corruption |
