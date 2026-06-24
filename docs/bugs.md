# Bugs — Dashboard Sprint (2026-06-23)

Discovered by 3-sonnet fan-out hunt. Deduplicated by Opus.

---

## B40 — Save during Run corrupts exec_log audit trail

**Severity:** MAJOR  
**File:** `src/components/editor/editor.tsx:76-89`

**Evidence:**
```ts
const onRun = async () => {
  setRunning(true);
  // ...
  await saveFlowToServer(flowId, toDoc(), currentBranchId); // saves state A
  setRunResult(await runFlow(flowId, currentBranchId));      // runs whatever is on server
  // ...
};
```

**Problem:** If user clicks Save (line 69) while Run is in flight between lines 81 and 82, `onSave` overwrites server state with state B. `runFlow` then executes state B, but the audit trail (exec_log + commit snapshot) was captured from state A's save. The ExecLogEntry.commitId points to the wrong graph.

**Proving input:** Click Run → while save is in flight, edit canvas and click Save → exec_log entry references wrong snapshot.

---

## B41 — Dashboard create button sticks disabled forever

**Severity:** MAJOR  
**File:** `src/components/dashboard/dashboard.tsx:29-37`

**Evidence:**
```ts
const handleCreate = async () => {
  setCreating(true);
  try {
    const flow = await createNewFlow("Untitled flow");
    onSelectFlow(flow.id); // if this throws, catch runs setCreating(false)? No — catch only catches.
  } catch {
    setCreating(false); // only runs if createNewFlow OR onSelectFlow throws
  }
};
```

**Problem:** If `createNewFlow` succeeds but `onSelectFlow` throws (setState error, component interaction issue), the catch block does run — but `creating` was already set to true and the component shows the disabled button. However the real issue is: if `onSelectFlow` navigates away (unmounts Dashboard), and the navigation itself partially fails or is slow, the button stays disabled with no error shown and no way to retry without refresh.

Actually on re-read: if `onSelectFlow` throws, catch DOES fire and resets `creating`. The real bug is narrower — if `createNewFlow` succeeds and `onSelectFlow` succeeds (navigates away), but React scheduling delays the unmount, there's no issue. **Downgrading: this is a ghost.** The try/catch correctly handles all paths.

---

## B41 — RETRACTED (not a real bug)

---

## B42 — formatRelativeDate shows confusing output for future timestamps

**Severity:** MINOR  
**File:** `src/lib/format-date.ts:7-9`

**Evidence:**
```ts
const diffDays = Math.round(
  (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
);
if (diffDays === 0) return `Today at ${time}`;
if (diffDays === 1) return "Yesterday";
// negative diffDays (future) falls through to bare date format
```

**Problem:** Server clock slightly ahead of client → `updatedAt` is in the future → `diffDays` is negative → falls through to bare date format ("Jun 23") instead of "Today at HH:MM". For a flow just saved, user sees a bare date instead of "Today at ...".

**Proving input:** Set server clock 2 seconds ahead. Save a flow. Dashboard shows "Jun 23" instead of "Today at 10:45 PM".

---

## B43 — formatRelativeDate renders "Invalid Date" for malformed ISO strings

**Severity:** MINOR  
**File:** `src/lib/format-date.ts:2`

**Evidence:**
```ts
export function formatRelativeDate(iso: string): string {
  const date = new Date(iso); // no validation — garbage in → Invalid Date
  // ...NaN propagates through all math, falls to:
  return date.toLocaleDateString(...); // → "Invalid Date"
}
```

**Problem:** If DB returns a malformed `updated_at` (null coercion, empty string from migration bug), the dashboard renders literal "Invalid Date" text on the flow card.

**Proving input:** API returns `{ updatedAt: "" }` → card shows "Invalid Date".

---

## Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| B40 | Save during Run corrupts exec_log | MAJOR | not-a-bug (Save already disabled during Run) |
| B42 | Future timestamps show bare date | MINOR | fixed |
| B43 | Invalid Date renders in UI | MINOR | fixed |

### Dropped (ghosts)

- "Branch switch race in editor effect" — `live` flag per-closure correctly prevents stale writes
- "Dashboard create button sticks" — try/catch correctly resets on any throw path
- "Money precision in Stripe params" — `z.number().int()` rejects non-integers, doesn't truncate
- "Branch existence validation" — server FK errors are propagated, not a correctness bug
- "RunResult type mismatch" — speculative, unverified
