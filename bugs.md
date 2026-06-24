# bugs.md

Living bug ledger. Senior (Opus) is the **sole writer**. IDs are immutable; numbering
continues across hunts, never reused or renumbered.

## Hunt 2026-06-22 — whole app, ~2.3k LOC (5 hunters, hybrid partition+lens)

Tree hunted: `7f07aeb` (clean working tree). Scope: `src/lib/*`, `src/app/api/flows/**`,
`src/components/editor/*`, `db/schema.sql`, `scripts/*`. Excluded vendored `components/ui/*`.

---

### B01 — PUT validates `node.type` but never enforces `paramSchemas` — MAJOR — proven
- class: data-integrity · location: src/app/api/flows/[id]/route.ts:41-71 + src/lib/contract.ts:131-137 · found-by: H2 H3 H5 (3×)
- symptom: the PUT handler checks `typeof n.params === "object" && n.params !== null` but never calls `paramSchemas[n.type].parse(n.params)`. The Zod allowlist is dead code (`grep paramSchemas src/` → one hit, its own definition). Arbitrary/typed-wrong params persist to the `params` JSONB column and later land verbatim in `exec_log.request`.
- trigger: `PUT /api/flows/demo` body node `{type:"action.stripe.charge", params:{amount:"lots", currency:42, evil:"x"}}` → 200, persisted.
- expected vs actual: contract §2.5 says params are validated by the per-type zod allowlist at the API boundary → should 400. Actual: 200, poisoned row.
- test: src/app/api/flows/__route.test.ts::B01
- history: reported 06-22 → proven 06-22

### B02 — stripe `amount` typed `z.number()`, accepts fractional cents — MINOR — proven
- class: money-correctness · location: src/lib/contract.ts:135 · found-by: H2
- symptom: `amount: z.number()` accepts `9.99`; block-registry help states "smallest currency unit (cents) — 100 = $1.00" (integer). A real Stripe charge rejects float amounts.
- trigger: params `{amount: 9.99, currency:"usd"}` once B01 is fixed (today it's not even checked).
- expected vs actual: amount must be a non-negative integer. Actual: any float passes.
- test: src/app/api/flows/__route.test.ts::B02
- history: reported 06-22 → proven 06-22 (rides on the B01 fix)

### B03 — view x/y/width/height accept `NaN`/±`Infinity` (typeof-only guard) — MINOR — proven
- class: input-validation · location: src/app/api/flows/[id]/route.ts:57-64 · found-by: H3
- symptom: `typeof v[k] === "number"` is true for `Infinity`. `1e309` parses to `Infinity`, stored in `double precision`, returned by loadFlow → React Flow places node at `Infinity` (invisible/unmovable). Canvas corrupted on round-trip.
- trigger: `PUT` view `{nodeId:"n1", x:1e309, y:0, width:160, height:80}`.
- expected vs actual: non-finite numbers rejected 400. Actual: stored.
- test: src/app/api/flows/__route.test.ts::B03
- history: reported 06-22 → proven 06-22

### B04 — PUT accepts edges/views referencing non-existent node ids — MAJOR — proven
- class: referential-integrity · location: src/app/api/flows/[id]/route.ts:50-64 · found-by: H3 (+ H1 corroborated torn-read consequence)
- symptom: edge `fromNodeId`/`toNodeId` and view `nodeId` are only type-checked as strings, never checked against `body.nodes` ids. A dangling edge passes app validation; the DB FK then throws → 500 with a raw pg error (constraint/table names) leaked to the client. Orphan views (no FK) persist silently.
- trigger: nodes `[{id:"n1"}]`, edges `[{id:"e1", fromNodeId:"n1", toNodeId:"GHOST"}]`.
- expected vs actual: 400 "edge references unknown node" before any DB write. Actual: 500 + pg internals (or silent orphan view).
- test: src/app/api/flows/__route.test.ts::B04
- history: reported 06-22 → proven 06-22

### B05 — PUT accepts duplicate node ids → PK violation 500 + leak — MINOR — proven
- class: input-validation · location: src/app/api/flows/[id]/route.ts:41-49 · found-by: H3
- symptom: no dedup of `nodes`/`edges`/`views` ids. Two nodes with the same id pass validation; the second INSERT hits `PRIMARY KEY (branch_id, id)` → transaction aborts → 500 with raw pg error.
- trigger: nodes `[{id:"dup"},{id:"dup"}]`.
- expected vs actual: 400 "duplicate node id". Actual: 500 + pg internals.
- test: src/app/api/flows/__route.test.ts::B05
- history: reported 06-22 → proven 06-22

### B06 — invalid JSON body → `req.json()` throws outside try/catch → 500 not 400 — MINOR — proven
- class: error-handling · location: src/app/api/flows/[id]/route.ts:28 · found-by: H4
- symptom: `const body = (await req.json())` at line 28 sits above both the shape guard and the `try/catch` (starts line 73). Malformed JSON → uncaught `SyntaxError` → 500.
- trigger: `PUT` with body `{broken json`.
- expected vs actual: 400 "invalid JSON". Actual: uncaught throw → 500.
- test: src/app/api/flows/__route.test.ts::B06
- history: reported 06-22 → proven 06-22

### B07 — catch blocks return `String(e)` leaking raw pg/internal errors — MINOR — proven
- class: info-disclosure · location: src/app/api/flows/[id]/route.ts:19,86 + run/route.ts:62 · found-by: H3
- symptom: every catch serializes `String(e)` into the response body. DB/connection errors expose constraint names, table names, host/port.
- trigger: any of B04/B05, or a DB outage.
- expected vs actual: generic `{error:"internal error"}` to client, detail to server log. Actual: pg internals returned.
- note: largely *prevented* by the B04/B05 fixes (reject before the DB throws). The residual generic-500 path is sanitized in the same change.
- history: reported 06-22 → proven 06-22 (fixed-with: B04/B05)

### B08 — `loadFlow` reads node/edge/view on 3 pool connections w/o a transaction → torn read — MAJOR — proven
- class: concurrency · location: src/lib/flow-repo.ts:189-205 · found-by: H1 H2 H4 (3×)
- symptom: `Promise.all([pool.query, pool.query, pool.query])` leases 3 separate connections at 3 snapshot boundaries. A concurrent `saveFlow` (atomic DELETE-then-INSERT) can interleave → nodes from the new state, edges from the old → `GraphDocument` whose edges reference absent nodes (then silently dropped by `fromGraphDocument`).
- trigger: simultaneous `PUT /api/flows/demo` + `GET`/`POST .../run`.
- expected vs actual: one consistent snapshot. Actual: mixed-generation read.
- history: reported 06-22 → proven-by-inspection 06-22 → **deferred** (single-user demo never triggers it; fix = wrap the 3 reads in one `REPEATABLE READ` transaction on a single client; deterministic red test impractical without pausing mid-`saveFlow`). Recommended top follow-up.

### B09 — `persistRun` SELECTs branch head without `FOR UPDATE` → concurrent runs fork the commit DAG — MAJOR — proven
- class: concurrency / data-integrity · location: src/lib/flow-repo.ts:129-147 · found-by: H2
- symptom: two concurrent runs both read head=X, mint commits A and B both with `parent_id=X`, both UPDATE head; last writer wins → A orphaned, DAG forked. Directly undermines the Rung 2/3 ★ version-history star.
- trigger: two `POST .../run` within ms.
- expected vs actual: linear chain X→A→B. Actual: X→A, X→B; A unreachable.
- history: reported 06-22 → proven-by-inspection 06-22 → **deferred** (fix = `SELECT head_commit_id ... FOR UPDATE`; one line, low risk, but deterministic red test needs pausing inside persistRun). Recommended top follow-up — pairs with B08.

### B10 — `verify-stripe.ts` paymentIntents.create(confirm:true) may need payment_method_types/automatic_payment_methods on pinned API — MAJOR — not-test-verifiable
- class: api-misuse · location: scripts/verify-stripe.ts:15-24 · found-by: H5
- symptom: with `confirm:true` and only an explicit `payment_method`, the pinned `2026-05-27.dahlia` API *may* require `payment_method_types:["card"]` or `automatic_payment_methods`. Hunter claims `verify:stripe` always fails.
- status: not-test-verifiable (needs a live Stripe key + network; claim about external API behavior is **unconfirmed by us**). Manual verify: `npm run verify:stripe` with a test key. Rung 4 (Stripe) — already deferred by user. Record only; do NOT fix blind.

### B11 — `verify-db.ts` exits 0 when zero tables → CI can't gate on schema presence — MINOR — not-test-verifiable
- class: script · location: scripts/verify-db.ts:28-31 · found-by: H5
- symptom: the `tables.length === 0` branch only `console.log`s; never sets `process.exitCode = 1`. `npm run verify:db && echo ready` passes against an uninitialized DB.
- expected vs actual: exit non-zero when schema absent. Actual: exit 0.
- status: fix is a 2-line guard; not unit-testable (reads a live DB) → manual verify: run against an empty DB, expect non-zero exit. Easy fix this round (sonnet).

### B12 — editor: Save enabled during a run (and Run during a save) → concurrent saveFlow double-submit — MINOR — proven
- class: race / UX · location: src/components/editor/editor.tsx:101,110 · found-by: H4
- symptom: Run is `disabled={running || status==="loading"}`; Save is `disabled={status==="saving"||status==="loading"}` — Save ignores `running`. `onRun` internally saves then runs, so clicking Save mid-run fires a second concurrent `saveFlowToServer`. (Symmetric: Run is not disabled while a manual save is in flight.)
- trigger: click Run, then click Save before it finishes.
- expected vs actual: both buttons disabled while either op is in flight. Actual: double-submit possible.
- test: src/components/editor/editor.test.tsx::B12
- history: reported 06-22 → proven 06-22 (easy fix → sonnet)

### B13 — editor: Save status stuck on "saved"; later edits still show "Saved" — MINOR — proven
- class: UX / state · location: src/components/editor/editor.tsx:48-56 · found-by: H4
- symptom: `onSave` sets `status="saved"` and never resets. After the user edits the canvas the button still reads "Saved" with a check — misleading "clean" signal.
- trigger: save successfully, then add/move a node.
- expected vs actual: status returns to "idle" (dirty) after an edit or a short timeout. Actual: stuck "saved".
- test: src/components/editor/editor.test.tsx::B13
- history: reported 06-22 → proven 06-22 (easy fix → sonnet)

### B14 — interpreter: condition.if drops unlabeled outgoing edges when any true/false label present — MINOR — proven
- class: edge-case · location: src/lib/interpreter.ts:79-86 · found-by: H1
- symptom: mixed-label fan-out (`.some(true||false)` → filter to `"true"`) silently drops unlabeled edges.
- status: proven (pure-testable) → **deferred**. Real condition evaluation is Rung 4/6 DoD; "always-true" demo never produces mixed labels. Don't reshape the run spine on a quick fix.

### B15 — interpreter: condition.if with only a "false" edge → empty walk, silent no-op run — MINOR — proven
- class: edge-case · location: src/lib/interpreter.ts:79-86 · found-by: H1
- symptom: only a `"false"` edge → `filter("true")` → `[]` → downstream unreachable, run returns `{commitId:null, entries:[]}` with no signal.
- status: proven → **deferred** (arguably correct under always-true semantics; same Rung 4/6 owner as B14).

### B16 — interpreter: multiple/duplicate trigger nodes → non-deterministic start — MINOR — proven
- class: edge-case · location: src/lib/interpreter.ts:94-96 + src/lib/flow-repo.ts:190 · found-by: H1
- symptom: `doc.nodes.find(trigger)` returns the first by array order, and loadFlow uses `ORDER BY id` (lexicographic nanoid) → which trigger runs is unrelated to user intent; the other trigger's subgraph is skipped.
- status: proven → **deferred** (demo has one trigger; multi-trigger UX is a design decision).

### Closed without fix
- **R01** `fromDoc` useEffect dep refires & nukes canvas (H4-BUG2) — **rejected**: Zustand store methods are referentially stable (defined once in the creator, never reassigned); the selector returns the same ref each render, so `useEffect([fromDoc])` runs exactly once. Hunter hedged; no proving line.
- **R02** `nodeSeq` id collision on reload (H4-BUG6) — **rejected**: within a session `nodeSeq` is monotonic; across reload the wall clock advances seconds. Real collision astronomically unlikely. Parked as optional hardening (switch to nanoid/`crypto.randomUUID`).
- **R03** `b.rowCount === 0` null-safety (H1/H4 parking) — **rejected**: for a SELECT, pg always returns a numeric `rowCount`.
- **R04** `RunResult.commitId` null conflates "no actions" vs error (H1-BUG4/6) — **rejected**: documented decision (risk-m5); no wrong result, crash, or data loss — a type-design nit.
- **R05** `runGraph({fromNodeId})` accepts a non-trigger node (H1-BUG3/5) — **parked**: no caller passes the option; latent API hardening only.
- **R06** `fromGraphDocument` silently drops orphan edges (H3-BUG9) — **not-a-bug**: documented defensive normalization; the real upstream cause is B04 (reject at PUT).

### Parked (recorded, not fixed — hardening / out of demo scope)
- No request body-size limit on PUT (H3-BUG8) — DoS vector; demo scope.
- `credentialRef` has no length cap (H3-BUG7) — parameterized, so no injection; row-bloat only.
- `node.type` / `exec_log.action_type` lack DB `CHECK` constraints (H5-BUG-4) — defense-in-depth; route guards via `isNodeType`. Worth a migration post-demo.

---

## Hunt 2026-06-23 — API boundary + branch isolation (3 hunters, hybrid)

Tree hunted: `2376a57` (clean working tree). Scope: `src/app/api/flows/**`, `src/lib/flow-repo.ts`.

---

### B17 — cross-branch rollback applies foreign snapshot to active branch — MAJOR — fixed
- class: data-integrity / branch isolation · location: src/lib/flow-repo.ts:474-477 · found-by: H2 H3
- symptom: `rollbackToCommit` loaded commit by `(id, flow_id)` only — a commit from branch `experiment` could restore onto `main`.
- trigger: fork branch, commit on experiment, `POST /rollback {toCommitId: cExp}` on main.
- expected vs actual: reject (404/null). Actual (before fix): main overwritten with experiment snapshot.
- test: src/lib/flow-repo.test.ts::B17 (integration, requires DATABASE_URL)
- history: reported 06-23 → proven 06-23 → fixed 06-23

### B20 — JSON `null` body on POST routes → 500 not 400 — MINOR — fixed
- class: error-handling · location: commit/rollback/branches routes · found-by: H1
- symptom: `req.json()` on `null` assigns `body = null`; `"authorNote" in body` / `body.toCommitId` throws → outer catch → 500.
- trigger: `POST .../commit` with body `null`.
- expected vs actual: 400 "invalid JSON body". Actual (before fix): 500.
- test: commit/route.test.ts::B20, rollback/route.test.ts::B20, branches/route.test.ts::B20
- history: reported 06-23 → proven 06-23 → fixed 06-23

### B21 — `?branch=` empty string bypasses branch guard, runs main — MINOR — fixed
- class: input-validation · location: all branch-scoped routes · found-by: H1
- symptom: `searchParams.get("branch")` returns `""`; falsy skips `branchExists` check; `loadFlow(..., "")` falls back to main.
- trigger: `POST /run?branch=` executes main graph without error.
- expected vs actual: 400 "unknown branch". Actual (before fix): 200 against main.
- test: commit/route.test.ts::B21, run/route.test.ts::B21
- history: reported 06-23 → proven 06-23 → fixed 06-23

### Deferred from this hunt
- **B18** GET `/commits` flow-scoped, no `branchId` in payload — enables cross-branch rollback in UI (pairs with B17 fix at repo layer).
- **B19** concurrent PUT + commit forks head snapshot from live tables — needs `saveFlow` FOR UPDATE (pairs with B08/B09).

---

## Plan for this round

- **Fixed 06-23:** B17, B20, B21.
- **Deferred top follow-up:** B18, B19, B08, B09.

---

## Hunt 2026-06-23 #2 — executor + version DAG + viewers (senior sweep)

Tree hunted: `af078ea` (clean working tree). Scope: newly-real `stripe-executor.ts`,
`run/route.ts`, `interpreter.ts`, `flow-repo.ts` (re-sweep), `contract.ts`, route
handlers, editor/store, graph-diff/serialize, viewers, `db/schema.sql`.

**Process note — fan-out unavailable.** The 5 parallel `claude` sonnet hunters
dispatched (H1=version DAG, H2=executor/money, H3=API boundary, H4=editor state,
H5=diff/serialize/viewers) all returned empty `task_result` and wrote nothing to
disk — the subagent output channel is non-functional in this environment. With
user approval, the senior (Opus/glm-5.2) ran the hybrid sweep directly: deep read
of every owned file + one lens across the scope. Findings carry status `reported`
(no sonnet-authored red test this round — test phase is separate).

---

### B22 — stripe-executor silently substitutes a default amount (100¢) and currency ("usd") for API-valid inputs → wrong-amount charge — MAJOR — reported
- class: money-correctness · location: src/lib/stripe-executor.ts:32-39 · root-pair: src/lib/contract.ts:142 · found-by: senior (H2 lens)
- symptom: the executor's input guard disagrees with the API's own contract. The
  contract validates `amount: z.number().int().nonnegative()` (0 is legal) and
  `currency: z.string()` ("" is legal — verified: `z.string().safeParse("").success === true`).
  The executor then applies a STRICTER guard and, on mismatch, silently rewrites
  the value to a hardcoded default instead of failing:
    amount:   `typeof params.amount === "number" && params.amount > 0 ? params.amount : 100`
    currency: `typeof params.currency === "string" && params.currency.length > 0 ? params.currency : "usd"`
  So an API-valid node reaches the real Stripe call with a DIFFERENT amount/currency
  than the user configured, with status "success".
- trigger (amount): UI → add Stripe Charge → clear the Amount field (side-panel.tsx:102
  `Number("")` → 0) → Save (contract accepts 0) → Run in live mode (MOCK_MODE off,
  STRIPE_SECRET_KEY set) → executor sees `0 > 0` false → charges **100¢** for a node
  the user set to charge $0. Recorded in exec_log as `status:"success"`, `amount:100`.
- trigger (currency): set currency to "" (or any value the API's `z.string()` admits)
  → executor charges in **"usd"** regardless of the node's currency.
- expected vs actual: the executor must honor the API-validated amount/currency
  (including 0 / "" if the contract admits them), OR the contract must forbid them
  (`.min(1)` / `.int().positive()`) so they 400 at PUT. Today the two layers
  disagree and the executor silently charges the wrong value. A wrong-amount charge
  on a real Stripe call is money loss for the customer.
- evidence:
    src/lib/stripe-executor.ts:32-39  (the `> 0` / `.length > 0` → default rewrite)
    src/lib/contract.ts:142           (`amount: z.number().int().nonnegative()` admits 0;
                                       `currency: z.string()` admits "")
- severity note: MAJOR by the ledger's existing calibration (B02 fractional-cents
  was MINOR; this is strictly worse — it changes the charge VALUE, not the format,
  and succeeds silently). **CRIT-eligible the moment a live (non-test) key is set.**
- repair sketch (one source-level decision): make the two layers agree — either
  tighten the contract to `amount: z.number().int().positive()` + `currency: z.string().min(1).max(8)`
  so invalid values 400 at the API, AND drop the executor's default-substitution
  (fail the action with `status:"failure"` if an invalid amount/currency ever
  reaches it). One contract test + one executor unit test cover both halves.
- history: reported 06-23

### B23 — run/route mints a fresh execId per POST → Stripe idempotency key is not stable across retries → double-charge on retry — MAJOR — reported
- class: money-correctness / idempotency · location: src/app/api/flows/[id]/run/route.ts:41,47 + src/lib/stripe-executor.ts:49 · found-by: senior (H2 lens)
- symptom: the Stripe idempotency key passed to `stripe.charges.create(..., { idempotencyKey })`
  is the per-action `execId`, and `execId` is `randomUUID()` minted fresh on every
  POST /run. Stripe's idempotency contract requires the key to be STABLE across
  retries of the same logical operation; a fresh key per request means a retried
  POST is treated as a brand-new charge. There is no client-supplied request token
  (no `Request-Id` / runId) and no `(runId, nodeId)`-derived key.
- trigger: Run in live mode → `stripe.charges.create` succeeds server-side → the
  response is lost to a network timeout / proxy retry / user-initiated re-POST →
  the second POST mints a new execId → Stripe sees a new idempotency key → **second
  real charge**. The two charges have different chargeIds; neither is deduped.
  Amplified by B22's silent-success pattern: both charges return `status:"success"`.
  Also: if `persistRun` throws AFTER Stripe charged (DB outage mid-run), the charge
  is orphaned — money moved, no exec_log row, no commit — and the natural user
  retry mints a new execId and charges again.
- expected vs actual: idempotency key stable across retries of the same logical run
  (derive from a client-supplied runId, or a deterministic `(commitId|runNonce, nodeId)`
  tuple). Actual: random per request → no idempotency across retries.
- evidence:
    src/app/api/flows/[id]/run/route.ts:41  `const commitId = randomUUID();`
    src/app/api/flows/[id]/run/route.ts:47  `const execId = randomUUID();`
    src/lib/stripe-executor.ts:49            `{ idempotencyKey }`   (= execId from caller)
- mitigation in place: the Run button is disabled while `running` (editor.tsx:119),
  blocking the common double-click. The residual vector is network/proxy retry, which
  the button does not cover.
- severity note: MAJOR (real double-charge under retry; button-disabled prevents the
  common case). CRIT-eligible under a live key. Pairs operationally with B22 (same
  executor path, same demo-scope mitigation).
- history: reported 06-23 → fix landed 06-23 (deterministic `sha256(flowId:branch:nodeId:request)` key, replacing `randomUUID()`) → **regressed into B25** (key now collides with `exec_log.id` PK on re-run → 500). The fix satisfied Stripe-stability but omitted the per-run discriminator B23's own repair sketch called for. Reopen pending a correct fix (see B25/B27).

### B24 — no `UNIQUE(flow_id, name)` on branch → duplicate branch names allowed → version-panel's name-based main-branch lookup is ambiguous — MINOR — reported
- class: data-integrity / input-validation · location: db/schema.sql:13-19 + src/app/api/flows/[id]/branches/route.ts:41-46 + src/components/editor/version-panel.tsx:61-64 · found-by: senior (H3 + H1 lenses)
- symptom: the `branch` table has `primary key (id)` but no uniqueness constraint on
  `(flow_id, name)`. The createBranch route only checks `name` is a non-empty string
  (no length cap, no format, no uniqueness). A user can fork a second branch named
  "main". The version-panel then resolves the main branch by NAME:
    `const mainBranch = branches.find((b) => b.name === "main");`
  With two "main" rows, `find` returns the first by array order — `effectiveBranchId`
  and the `<select>`'s fallback bind to whichever row happens to sort first, not to
  the canonical main branch. The fork-source resolution (`headCommitId`) is id-based
  downstream, so the blast radius is bounded to the selector binding + the
  `currentBranchId ?? mainBranch?.id` fallback, but the ambiguity is real.
- trigger: create branch named "main" (createBranch accepts it) → reload → the
  branch selector and the main-branch fallback resolve to the first "main" by sort
  order, which need not be the saveFlow-created canonical main.
- expected vs actual: branch names unique per flow (DB `UNIQUE(flow_id, name)` +
  route 409 on conflict, mirroring commit's referential discipline). Actual:
  duplicates silently created, name-based UI lookup is ambiguous.
- evidence:
    db/schema.sql:13-19                          (no unique constraint on flow_id,name)
    src/app/api/flows/[id]/branches/route.ts:41  (`typeof body.name !== "string"` only)
    src/components/editor/version-panel.tsx:61   (`branches.find(b => b.name === "main")`)
- history: reported 06-23

---

### Closed without fix (this hunt)
- **R07** executor uses legacy `stripe.charges.create` with `source:"tok_visa"` (H2)
  — **not-a-bug / parked**: `tok_visa` is a Stripe test token that only works in
  test mode; in live mode the charge fails (returned as `status:"failure"`, no money
  moved). This is the documented "test mode in the demo" posture (block-registry
  help text). The modern PaymentIntents migration is B10-adjacent and already
  deferred to Rung 4. Record only.
- **R08** `executeAction`/`getStripe` → `new Stripe(key)` can throw on a malformed
  key, propagating to run/route's outer catch → 500 (H2) — **rejected**: the throw
  happens at constructor time, before any charge; the 500 is the correct surface.
  No money moved, no state corruption.
- **R09** version-panel `onRollback(c.id)` 404s for commits from other branches
  because `listCommits` is flow-scoped not branch-scoped (H1/H4) — **deferred-root:
  B18**. This is the user-visible symptom of B18 (GET /commits needs `branchId`).
  Fix B18 at the source and this closes with it; not a separate defect.

### Parked (recorded, not fixed — hardening / out of demo scope)
- `updateNodeParam` read-merge-write is not atomic across concurrent updates to
  DIFFERENT fields on the same node (flow-store.ts:151-157). Not reachable from the
  UI (a user edits one field at a time); latent under programmatic multi-field
  patches. Switch to a functional `set` updater if that ever becomes a call site.
- `branch.name`, `commit.author_note`, `edge.condition`, `credentialRef` have no
  length caps at the route layer (B-credentialRef-parking from hunt 1 stands).
  Parameterized → no injection; row-bloat only.
- `listCommits` / `listExecLog` tiebreak on `(created_at DESC, id DESC)` with
  randomUUID ids → same-ms ordering is non-deterministic across branches
  (acknowledged in flow-repo.ts:391,419). Demo viewer only; a sequence column is
  the production fix.

---

## Plan for this round

- **Reported 06-23 (this hunt):** B22, B23, B24.
- **Recommended fix priority:** B22 + B23 together (same executor path, both
  money-correctness, both close with one contract-tightening + executor
  default-removal + idempotency-key redesign). B24 is a 2-line migration + route
  guard, low risk, sonnet-eligible once a red test exists.
- **Still deferred from prior hunts:** B08, B09, B18, B19 (concurrency + branch
  scoping cluster).

---

## Hunt 2026-06-23 #3 — whole app re-sweep, 5 parallel `zai` (GLM-5.2) hunters

Tree hunted: working tree of `Advanced-paint-` (post-hunt-#2 code, incl. the landed
B23 deterministic-key fix). Scope: full `src/` (lib + app/api/flows/** + components/editor/**),
`db/schema.sql`, `scripts/*`. Hybrid partition: every file had one deep owner **AND**
each hunter carried one lens across the whole scope.

**Fan-out worked this round.** 5 `zai` subagents dispatched in one batch, all returned
full reports. Convergence signal: the flagship regression (B25) was independently found
by 4 of 5 hunters (H1, H2, H3, H5) from four different lenses (concurrency / money /
API-status / data-integrity) — high confidence.

Dedup matrix: F-H1-1 + F-H2-1 + F-H3-1 + F-H5-1 → **B25** (4×). F-H2-4 + F-H3-2 → **B28** (2×).
All others unique. Re-confirmed non-dupes against B01–B24, R01–R09, and the parked list.

---

### B25 — deterministic `execId` (B23 fix overcorrection) collides with `exec_log` PK on re-run → 500 + DAG freeze — MAJOR — proven (4× convergence)
- class: data-integrity / idempotency-key-vs-row-PK conflation · location: src/app/api/flows/[id]/run/route.ts:47-51 + src/lib/flow-repo.ts:213-226 + db/schema.sql:71 · found-by: H1 H2 H3 H5 (4×)
- symptom: the B23 fix replaced `execId = randomUUID()` with `idempotencyKey = sha256(flowId:branch:nodeId:JSON.stringify(request))`, then `const execId = idempotencyKey`. That same value is handed to `persistRun`, which does a plain `INSERT INTO exec_log (id, ...)` (no `ON CONFLICT`, unlike the flow/branch upserts at flow-repo.ts:128,135). `exec_log.id` is `text primary key`. So a second run of an unchanged node recomputes the identical hash → `23505 unique_violation` inside `persistRun`'s `BEGIN…INSERT commit…UPDATE branch…INSERT exec_log…COMMIT` tx → ROLLBACK → run/route.ts:90 catch → `500 {error:"internal server error"}`. The ROLLBACK also undoes the new `commit` and the `branch.head_commit_id` advance, so the version DAG freezes at the first run's commit. The root flaw is conflating "Stripe idempotency key" (must be stable across retries) with "exec_log row PK" (must be unique per row) — one value cannot satisfy both.
- trigger (mock mode, demo default): `PUT` a flow with one action node → `POST /run` (200, commit C1) → `POST /run` again with no edits → **500**. Every subsequent identical re-run 500s forever until a node param is edited (changing the hash). The demo's primary button bricks on the second click.
- trigger (live mode): `executeAction`→`stripe.charges.create` runs at route.ts:58 *before* `persistRun` at route.ts:88; on re-run Stripe correctly returns the cached charge (B23 satisfied), but `persistRun` still throws on the PK → 500, and the charge is left with **no exec_log row and no commit** — audit gap + money moved + user sees only an error.
- expected vs actual: each logical run mints its own commit + exec_log row even when params are identical (the `commitId` at route.ts:41 is already `randomUUID()` per request — only `exec_log.id` is wrongly deterministic). Actual: PK collision → 500, DAG frozen, (live) orphaned charge.
- why the existing test missed it: run/route.test.ts:69-76 asserts the B23 key-stability property but `vi.mock("@/lib/flow-repo", () => ({ persistRun: vi.fn() }))` (test:4-8) — `persistRun` is mocked, so the PK never throws. The collision only fires against a real `exec_log` PK.
- dedup: not a dupe of B23 — B23 is the *opposite* failure (key too random → double-charge). B25 is the fix-implementation defect: it went too far stable by omitting the per-run component B23's own sketch recommended (`(commitId|runNonce, nodeId)`). Different root cause (key/PK conflation), opposite symptom (500 + stuck vs money loss).
- evidence:
    src/app/api/flows/[id]/run/route.ts:47-51  `createHash("sha256").update(\`${id}:${branch ?? "main"}:${s.nodeId}:${JSON.stringify(s.request)}\`)…; const execId = idempotencyKey;`  (no commitId/nonce in the hash)
    src/lib/flow-repo.ts:213-215                `INSERT INTO exec_log (id, …) VALUES ($1, …)` (plain INSERT, no ON CONFLICT)
    db/schema.sql:71                            `id text primary key`
- test: needs-DB — two sequential `POST /run` against a real DB, assert 2nd is 500 today; after fix assert 200 + new commitId + 2nd exec_log row.
- repair sketch (one source-level decision, pairs with B27): keep a stable Stripe idempotency key but make `exec_log.id` per-row-unique. Minimum: `const execId = randomUUID();` and pass `idempotencyKey` only to `executeAction(...)`. Correct (also closes B27): derive both from a client-supplied `runId` — `idempotencyKey = H(runId:nodeId)`, `execId = H(runId:nodeId:commitId)` or just `randomUUID()`.
- history: reported 06-23 (#3) → proven 06-23 (4× independent)

### B26 — idempotency-key branch component is `"main"` but the real main branch id is `${flowId}-main` → key flips with `?branch=` presence → double-charge — MAJOR — reported
- class: money-correctness / idempotency · location: src/app/api/flows/[id]/run/route.ts:48 + src/lib/flow-repo.ts:184 + src/components/editor/editor.tsx:81 + src/lib/flow-store.ts:169 · found-by: H2
- symptom: the deterministic key's branch component is `branch ?? "main"` — the literal `"main"`. But the actual main branch id persisted by `saveFlow` is `${flowId}-main` (flow-repo.ts:114,184), and `persistRun` resolves `branch ?? \`${flowId}-main\`` inside the repo. So the same logical branch resolves to two different key components depending on whether the client passed `?branch=`. The editor passes `currentBranchId` verbatim to `runFlow` (editor.tsx:81); it is `undefined` on page load (flow-store.ts:169) and becomes `${flowId}-main` only after the user clicks the branch `<select>` (version-panel.tsx:124, whose displayed value falls back to `mainBranch?.id` even when the store value is undefined — UI shows "main" selected in both cases, hiding the difference).
- trigger: (1) load editor → Run (currentBranchId=undefined → key uses "main") → Stripe charges 100¢. (2) Click the branch `<select>` choosing "main" → currentBranchId becomes `${flowId}-main` → Run → key uses `${flowId}-main` → **different key** → Stripe charges 100¢ **again**. Same node, same params, same branch — two real charges, two chargeIds.
- expected vs actual: idempotency key stable across retries of the same logical operation regardless of `?branch=` presence. Actual: key flips when the client starts explicitly passing the main branch id, re-opening the exact double-charge B23 was meant to close.
- dedup: not B23 (per-POST randomUUID) — distinct defect in the deterministic key's branch component: even after B23's fix made the key deterministic, the branch identifier is wrong.
- evidence:
    src/app/api/flows/[id]/run/route.ts:48   `.update(\`${id}:${branch ?? "main"}:${s.nodeId}:…\`)`
    src/app/api/flows/[id]/run/route.ts:88   `await persistRun(getDb(), id, commitId, doc, records, branch);`  (branch undefined when no ?branch=)
    src/lib/flow-repo.ts:184                 `branchId: string = \`${flowId}-main\`,`  (the actual default)
    src/components/editor/editor.tsx:81      `setRunResult(await runFlow(DEMO_FLOW_ID, currentBranchId));`
    src/lib/flow-store.ts:169                `currentBranchId: undefined,`
- test: key-mismatch is pure-testable (`assert H(id, undefined, …) !== H(id, \`${id}-main\`, …)`); the double-charge itself needs-network (live Stripe).
- history: reported 06-23 (#3)

### B27 — deterministic key has no run discriminator → within Stripe's ~24h idempotency window, recurring/scheduled runs are silently deduped to the first charge — MAJOR — reported (masked by B25)
- class: money-correctness / idempotency · location: src/app/api/flows/[id]/run/route.ts:47-51 + src/lib/stripe-executor.ts:45 · found-by: H2
- symptom: the key is `sha256(flowId:branch:nodeId:request)` — no timestamp, no runId, no nonce. Stripe's idempotency window is ~24h; within it a repeated key with matching params returns the **cached original response** without creating a new charge. The demo's own `trigger.schedule` → `action.stripe.charge` path is a cron-driven recurring charge — it would charge once, then every subsequent scheduled run within 24h gets the stale chargeId echoed back with `status:"success"`. Money that should move doesn't, while exec_log records success.
- trigger: schedule trigger (cron) → stripe.charge(100). Run at T0 → real charge. Run at T0+1h, same params → Stripe returns cached response, no new charge, `status:"success"`.
- status: currently **masked** by B25 (the second run's exec_log INSERT throws before the user sees the cached success). Surfaces immediately the moment B25 is fixed. Recorded separately because the naive B25 fix (`ON CONFLICT DO NOTHING` on exec_log, keeping the stable key) re-opens this — the B25 fix MUST vary the key across distinct runs while keeping it stable across *retries of the same run* (client-supplied runId is the clean shape).
- expected vs actual: each logical run produces a distinct charge. Actual: repeated runs within 24h deduped to the first charge.
- dedup: not B23 (key too random → double-charge) and not B25 (DB PK collision). This is Stripe's own idempotency dedup at the API layer — the inverse of B23, unmasked by fixing B25.
- evidence:
    src/app/api/flows/[id]/run/route.ts:47-48  `createHash("sha256").update(\`${id}:${branch ?? "main"}:${s.nodeId}:${JSON.stringify(s.request)}\`)` (no run nonce/timestamp)
    src/lib/stripe-executor.ts:45              `{ idempotencyKey }` → `stripe.charges.create`
- test: needs-network (live Stripe to observe dedup).
- history: reported 06-23 (#3). Pairs with B25 (same fix root: add a per-run discriminator that is stable across retries, unique across distinct runs).

### B28 — non-stripe actions in live mode recorded as exec_log `status:"success"` via silent mock fallback (inconsistent with the no-key `"failure"` path) — MINOR — reported (2×)
- class: audit-integrity / status-correctness · location: src/app/api/flows/[id]/run/route.ts:53,62-64 + src/lib/stripe-executor.ts:29,75-78 · found-by: H2 H3
- symptom: `let status = "success"`; only overwritten when `executeAction` returns non-null. `executeAction` returns `null` for every non-stripe action (`action.slack.post`, etc. — only `action.stripe.charge` has a real executor, stripe-executor.ts:72-78 `default: return null`). So in live mode a slack.post node is mocked yet persisted with `status:"success"`. The same "can't execute this action" condition is handled inconsistently one branch away in `executeStripeCharge`: when `STRIPE_SECRET_KEY` is unset it returns `{status:"failure", response:{error:"no_key",mock:true}}`. So "stripe can't run (no key)" → failure, but "slack can't run (no executor)" → success. The `mock:true` flag disambiguates for a careful reader, but `status` is the primary audit field and the two paths disagree for the same semantic condition.
- trigger: `PUT` a flow with `action.slack.post` → `MOCK_MODE=0` (or unset), no key → `POST /run` → exec_log row carries `status:"success"` for the slack action.
- expected vs actual: a mocked/non-executed action in live mode recorded as `failure` (matching the no-key precedent) or at minimum not `success`. Actual: `success`.
- dedup: not B22/B23 (stripe executor amount/idempotency) — different branch, different action type. Not otherwise in Bxx.
- evidence:
    src/app/api/flows/[id]/run/route.ts:53      `let status: "success" | "failure" = "success";`
    src/app/api/flows/[id]/run/route.ts:62-64   `else { response = mockResponse(s.type, execId); }` (no `status =`)
    src/lib/stripe-executor.ts:29               `return { response: { error: "no_key", mock: true }, status: "failure" };` (contradictory precedent)
    src/lib/stripe-executor.ts:75-77            `default: return null;`
- test: pure-testable (mock `executeAction`→null, assert persisted `records[0].status`). Existing run/route.test.ts:9-14 mocks executeAction to always-success, so this path is untested.
- history: reported 06-23 (#3)

### B29 — executor catch stores raw Stripe error `message` into `response.error` → persisted to exec_log + returned to client (potential key/card-detail leakage) — MINOR — reported
- class: secret-handling / info-disclosure · location: src/lib/stripe-executor.ts:57-63 + src/app/api/flows/[id]/run/route.ts:60,89 · found-by: H2
- symptom: the executor catch serializes the raw Stripe error message (`err.message`) into `response.error`, which is (a) persisted verbatim into `exec_log.response` jsonb and (b) returned in the `entries` array of the `POST /run` JSON response. Stripe error messages can echo sensitive fragments — `Invalid API Key provided: sk_test_abcd****`, card-decline reasons, rate-limit headers. The contract §2.3 requires `exec_log.request` to be secret-free; the response column has no such guard.
- trigger: live mode with a malformed/revoked `STRIPE_SECRET_KEY` or a declined card source → `stripe.charges.create` throws → `response.error = err.message` → persisted + returned.
- expected vs actual: log full error server-side; store/return generic `{error:"charge_failed"}` to client and exec_log. Actual: raw `err.message` in both.
- dedup: not B07 (route-level outer catch serializing `String(e)` pg internals into the response body). This is the executor-level inner catch putting Stripe's own diagnostics into the structured `response` object — different path, different leak class, flows through exec_log persistence.
- evidence:
    src/lib/stripe-executor.ts:58-61   `const message = err instanceof Error ? err.message : String(err);` / `return { response: { error: message }, status: "failure" };`
    src/app/api/flows/[id]/run/route.ts:60,82,89   `response = result.response;` → into `entries` → `Response.json({ commitId, entries });`
- test: plumbing pure-testable (stub executor returning an error, assert `entries[0].response.error` is generic); the leak content needs-network.
- history: reported 06-23 (#3)

### B30 — bare `await c.query("ROLLBACK")` in catch can reject and mask the original error (5 sites) — MINOR — reported
- class: transaction-lifecycle / error-swallowing · location: src/lib/flow-repo.ts:148-150, 230-232, 380-382, 517-519, 599-601 · found-by: H1
- symptom: every transactional fn uses `} catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }` with no inner try around the ROLLBACK. If `e` was caused by (or coincided with) a broken connection — DB restart, idle-timeout sever, TLS drop, EPIPE — the ROLLBACK RPC on that same dead socket also rejects; that rejection propagates and `throw e` never runs. The route's outer catch then logs the ROLLBACK transport error ("Connection terminated") instead of the root query that aborted. A connection that errored mid-statement can also be recycled by `c.release()` in a state the next lessee observes as stale.
- trigger: `pg_terminate_backend(pid)` the connection inside `persistRun` mid-tx, then trigger any error path; server log shows the ROLLBACK failure, not the original abort.
- expected vs actual: original error surfaced; ROLLBACK failure expected after connection loss and swallowed. Expected `try { await c.query("ROLLBACK"); } catch {} throw e;`. Actual: ROLLBACK rejection overwrites `e`, pool may recycle a half-broken client.
- dedup: not B07 (client-facing `String(e)` leak — the run route already sanitizes to `{error:"internal server error"}`). This is server-log root-cause loss + pool hygiene.
- evidence: identical 3-line shape at flow-repo.ts:148-150, 230-232, 380-382, 517-519, 599-601.
- test: needs-DB (terminate connection mid-tx, observe logged message) or a `PoolClient` stub whose `query("ROLLBACK")` rejects.
- history: reported 06-23 (#3)

### B31 — side-panel `Number()` coercion breaks the controlled number input (clear→"0", "2."→2, "1e"/"-"→NaN that blanks the field) — MAJOR — reported
- class: client-state / controlled-input · location: src/components/editor/side-panel.tsx:95-104 (the `field.type === "number"` branch), `setParam` body at :52-56 · found-by: H4
- symptom: the input is controlled by `value={String(node.data.params[field.key] ?? "")}` while `onChange` runs the raw through `Number(e.target.value)`. Three distinct breakages from the same lines:
  1. **Clear shows "0".** `Number("") === 0` (not NaN) → store gets `amount:0`; `String(0 ?? "") === "0"` → the emptied field snaps back to "0". The `??` never fires (0 isn't nullish). The user cannot clear the field.
  2. **Decimals collapse.** Typing `"2."` (intending `"2.5"`) → `Number("2.")===2` → store stays 2 → next render `value="2"` (dot vanishes); next keystroke `"5"` lands against `"2"` → `"25"`, not `"2.5"`. Amount silently changes by 10×.
  3. **Client-side NaN produced and propagated** (the path complementing B03's API-side hole and B22's trigger). `type="number"` inputs DO emit `"1e"` / `"-"` as valid intermediate values; `Number("1e")===NaN` → store holds `amount:NaN`; `String(NaN ?? "")==="NaN"`, which a `type="number"` input coerces back to empty — field looks blank while store holds NaN → flows through `toGraphDocument` → wire as `"null"` → real Stripe save 400s with no visible cause in the UI.
- trigger: add Stripe Charge → click Amount → Ctrl-A, Backspace (field shows "0"); or type `2 . 5` (ends "25"); or type `1 e` (field blanks, store NaN).
- expected vs actual: input reflects what the user typed (or a parsed value that round-trips). Actual: empty snaps to "0", decimals collapse, intermediates poison the store with NaN and blank the field.
- dedup: not B03 (server-side acceptance of NaN/Infinity in `view.*`). This is the client-side **producer** of NaN/0 in `params.amount` via `Number()` — different file, different field, different layer. Not B22 (executor's silent default-substitution downstream); this is the upstream UI corruption that *produces* the `0` B22 names as trigger, plus NaN B22 doesn't mention.
- evidence:
    src/components/editor/side-panel.tsx:100  `value={String(node.data.params[field.key] ?? "")}`
    src/components/editor/side-panel.tsx:102  `onChange={(e) => setParam(field, Number(e.target.value))}`
- test: pure-testable (jsdom) — render `<SidePanel>` for a stripe node, `fireEvent.change` `field-amount` with `""`, `"2."`, `"1e"`; assert both displayed `value` and `useFlowStore.getState().nodes[0].data.params.amount`.
- history: reported 06-23 (#3) (easy fix → sonnet: keep the raw string in store, parse at the boundary; or use `type="text"` inputMode="decimal")

### B32 — VersionPanel mutating buttons (Commit/Rollback/Branch) not disabled during an in-flight Run → concurrent `saveFlowToServer` + wrong-generation run — MAJOR — reported
- class: UX race / disabled-state gap · location: src/components/editor/version-panel.tsx:146,193,200 (buttons) + 68-113 (handlers, esp. :73 `saveFlowToServer`) + src/components/editor/editor.tsx:31,119,128 · found-by: H4
- symptom: `running` lives only in `Editor`'s local `useState` (editor.tsx:31). The B12 fix added `running ||` to **Editor's** Save/Run disabled clauses (editor.tsx:119,128), but VersionPanel is a sibling that never sees `running`. Every mutating button in VersionPanel is gated solely by its OWN local `busy`:
    version-panel.tsx:146  `<Button onClick={onCommit} disabled={busy}>`
    version-panel.tsx:193  `disabled={busy}`                                    // Rollback
    version-panel.tsx:200  `disabled={c.parentId == null || busy}`              // Diff
  So while `running===true` the user can click Commit (which itself calls `saveFlowToServer(DEMO_FLOW_ID, doc, currentBranchId)` at version-panel.tsx:73) — racing Editor's `onRun`, which has its own `saveFlowToServer` in flight at editor.tsx:80. Same hole on `onRollback` (overwrites canvas via `fromGraphDocument`) and `onCreateBranch`.
- trigger: click Run → before the spinner clears, click Commit (or Rollback, or Branch) in the right-hand panel.
- expected vs actual: all server-mutating buttons disabled while either op is in flight (B12 generalized across components). Actual: only Editor's buttons gated; VersionPanel fires a second concurrent `saveFlowToServer` plus `commitFlow`/`rollbackFlow` against the same branch.
- consequence: two concurrent `saveFlow`s to the same branch; `loadFlow` inside run/route.ts:22 reads whichever save committed last — may differ from the state the user saw when they clicked Run. For the Stripe node that's a wrong-amount-execution vector B22/B23 won't catch (executor is fine; wrong state was handed to it). DAG stays linear (persistRun/commitFlow `SELECT … FOR UPDATE`), but a captured commit can mis-document what ran.
- dedup: not B12. B12's recorded location is `editor.tsx:101,110`; its fix added `running ||` only to those two `disabled=` props. This is the same race in a **different file** (`version-panel.tsx`), **different buttons** (Commit/Rollback/Branch), via **different `saveFlowToServer` call sites** (version-panel.tsx:73 vs editor.tsx:68/80) never in B12's scope. B12 is fixed; this is the follow-on gap.
- evidence: see location lines above.
- test: needs-DOM — lift `running` into the store and unit-test the gate; assert that with `running===true`, clicking Commit does not call `saveFlowToServer` a second time.
- history: reported 06-23 (#3) (easy fix → sonnet: hoist `running` into flow-store, gate VersionPanel buttons on it)

### B33 — VersionPanel never refetches after a Run → commits list + branch `headCommitId` go stale; the Run's auto-created commit is invisible and un-rollback-able, and new branches fork from before the Run — MAJOR — reported
- class: client-state / store-subscription gap · location: src/components/editor/editor.tsx:75-88 (onRun tail), src/components/editor/version-panel.tsx:20-22,45-55,65-66, src/lib/flow-repo.ts:201-210 · found-by: H4
- symptom: a Run with ≥1 action mints and persists a fresh commit on the active branch — `persistRun` INSERTs into `"commit"` and `UPDATE branch SET head_commit_id` (flow-repo.ts:201-210, from run/route.ts:88). Editor's `onRun` then calls `bumpExecLog()` (editor.tsx:82), which only bumps `execLogNonce`. `ExecLogViewer` subscribes to that nonce and re-fetches (exec-log-viewer.tsx:10,32). **VersionPanel does not subscribe to `execLogNonce`**; its only fetches are the mount effect (`[]` deps, version-panel.tsx:45-55) and `refresh()` inside `onCommit`/`onRollback`/`onCreateBranch` (:76,:90,:106). After a Run:
  - `commits` is stale — the Run's commit (authorNote `"run"`, flow-repo.ts:204) never appears.
  - `branches` is stale — `headCommitId` still points at the pre-Run head.
- trigger: Stripe node wired to a trigger → Run → watch the Version panel: the new "run" commit never appears; Rollback list excludes it. Type a name → "Branch" → `onCreateBranch` forks from `headCommitId` resolved out of the **stale** `branches` state (:65-66), so the new branch forks from BEFORE the Run, silently dropping the Run's commit from the branch DAG.
- expected vs actual: after a Run the version panel reflects the new commit + new head. Actual: stale until the user happens to click Commit/Rollback/Branch (each calls `refresh()`); no manual refresh control.
- dedup: not B12 (button-disabled) or B13 (Save badge). Not B18 (deferred server-side: GET /commits needs `branchId` payload) — B18 is about the data the endpoint returns; this is the **client never asking the endpoint again** after a Run, so even existing flow-scoped data goes stale. Not R09 (cross-branch rollback 404) — here the Run's commit isn't in the list to click in the first place.
- evidence:
    src/components/editor/editor.tsx:82         `bumpExecLog();`  (only post-Run signal)
    src/components/editor/exec-log-viewer.tsx:10,32  subscribes to `execLogNonce` → refetches
    src/components/editor/version-panel.tsx:20-22   subscribes only to currentBranchId/setCurrentBranchId/bumpExecLog (the fn, not a nonce)
    src/components/editor/version-panel.tsx:45-55   `useEffect(…, [])`  mount-only
    src/components/editor/version-panel.tsx:65-66   `branches.find(…)?.headCommitId ?? null`  stale after Run
- test: pure-testable (jsdom) — render `<VersionPanel/>`, let `listCommits`/`listBranches` resolve, `act(() => useFlowStore.getState().bumpExecLog())`; assert `listCommits` called again. It won't be → red.
- history: reported 06-23 (#3) (easy fix → sonnet: subscribe VersionPanel to a `versionNonce` that onRun bumps, or reuse execLogNonce)

### B34 — load effects use only a `live` flag, no `AbortController` → rapid branch switches (and Strict-Mode dev mounts) leave zombie fetches — MINOR — reported
- class: effect-lifecycle / resource-cleanup · location: src/components/editor/editor.tsx:39-54 (same shape at version-panel.tsx:45-55, exec-log-viewer.tsx:15-32) + src/lib/flow-client.ts:19-29 · found-by: H4
- symptom: the load effect cancels stale state application via `let live = true` but never aborts the underlying `fetch`. Each cleanup sets `live=false`; the in-flight request still consumes network/DB resources. Fast A→B→C branch switch → 3 `fetchFlow` alive, 2 zombie. React 18/19 Strict Mode dev doubles every mount → 2 GETs on every load. `fetchFlow` doesn't accept an `AbortSignal`; the route handler can't cancel the SQL. Behavior is functionally correct (no stale state lands) — this is wasted server work + dev-mode noise.
- trigger: rapidly switch branches; or open the app in dev (Strict Mode mounts effects twice → 2 GETs each load).
- expected vs actual: cleanup cancels the in-flight request (`controller.abort()`). Actual: cleanup only orphans the callback; the request runs to completion and the response is discarded.
- dedup: not R01 (rejected hypothesis that the `fromDoc` dep refires and nukes the canvas — store methods are stable, effect doesn't re-fire on its own). This is about what cleanup does when a REAL dep change legitimately re-fires it. Not B08 (concurrency in `loadFlow` itself).
- evidence:
    src/components/editor/editor.tsx:39-54  `useEffect(() => { let live = true; (async () => { … await fetchFlow(…) … if (live && d) fromDoc(d); … })(); return () => { live = false; }; }, [fromDoc, currentBranchId]);`
    src/lib/flow-client.ts:23-25             `const res = await fetch(\`/api/flows/${…}${branchParam(branch)}\`);`  (no signal)
- test: not-test-verifiable — user-visible behavior is correct (live flag prevents stale state); a red test can only assert wasted requests (a perf claim).
- history: reported 06-23 (#3)

### B35 — `DiffView` cleanup calls `setState` → anti-pattern + Strict-Mode double-fetch — MINOR — reported
- class: effect-lifecycle · location: src/components/editor/diff-view.tsx:39-50 · found-by: H4
- symptom: the cleanup does `setDiff(null); setError(null);` in addition to `live=false`. This is the "setState-in-cleanup" anti-pattern: forces an extra re-render between prop changes, and under Strict Mode (dev) the mount→unmount→mount cycle runs cleanup before the 2nd mount → 2 `diffFlow` network calls alive, the first guaranteed discarded. Intent (reset to `loading` between `from`/`to` changes so the spinner shows) is achievable without setState-in-cleanup by deriving `loading` from a request-id.
- trigger: open the Diff modal — dev Strict Mode fires 2 GETs to `/diff?from=…&to=…`. Changing the selected commit while the modal is open fires another pair.
- expected vs actual: one fetch per (`flowId`,`from`,`to`) tuple in dev. Actual: two (one zombie) + extra render per prop change.
- dedup: not B34. B34 is "no AbortController" (network-cancellation gap, app-wide); this is "setState during cleanup" (render-cycle / Strict-Mode anti-pattern specific to `diff-view.tsx`). Different files, different mechanisms — only DiffView has this one.
- evidence:
    src/components/editor/diff-view.tsx:44-49  `return () => { live = false; setDiff(null); setError(null); };`
- test: needs-DOM — render `<DiffView/>` in `<React.StrictMode>` with mocked `diffFlow`, assert call count 1 (will be 2 → red).
- history: reported 06-23 (#3)

### B36 — `listExecLog` is flow-scoped not branch-scoped → cross-branch execution entries bleed into the active branch's Execution Log — MINOR — reported
- class: viewer-rendering / branch-isolation · location: src/lib/flow-repo.ts:421-431 + src/components/editor/exec-log-viewer.tsx:15-32 · found-by: H5
- symptom: `listExecLog` filters only by `flow_id` (`WHERE flow_id = $1`). The viewer's `useEffect` depends solely on `[execLogNonce]` — it does not refetch on branch switch, and even if it did the query returns the same flow-scoped set. After forking `experiment`, running on it, then switching the selector to `main`, main's Execution Log still lists experiment's rows (only `commit_id` differs; no `branch_id` exposed/filtered). The schema permits the join `exec_log.commit_id → commit.branch_id` needed to scope correctly, but neither repo nor route performs it.
- trigger: create branch `experiment` → Run on experiment (creates exec_log rows) → switch selector to `main` → main's Execution Log lists experiment's rows.
- expected vs actual: ExecLogViewer shows only entries for commits on the active branch (or at minimum refetches on branch switch). Actual: flow-wide bleed, no refetch on branch change.
- dedup: not B18 (GET /commits needs branchId payload) / R09 (version-panel rollback 404). Different endpoint (`GET /exec-log`), different payload (`ExecLogEntry[]`), different surface (exec-log-viewer panel), different missing filter (no `commit.branch_id` join). Same anti-pattern, distinct defect.
- evidence:
    src/lib/flow-repo.ts:425-430                    `SELECT … FROM exec_log WHERE flow_id = $1 ORDER BY created_at DESC, id DESC`  (no branch filter; commit_id present but not joined)
    src/components/editor/exec-log-viewer.tsx:15-32 `useEffect(() => { … listExecLog(DEMO_FLOW_ID) … }, [execLogNonce])`  (no currentBranchId in deps; no client filter)
- test: needs-DB.
- history: reported 06-23 (#3)

### B37 — `init-db.ts` SQL splitter ignores single-quote state → `--` inside `'...'` literals treated as comment → future migration corruption — MINOR — reported (latent)
- class: script / SQL-parsing edge case · location: scripts/init-db.ts:46-48 · found-by: H5
- symptom: the statement splitter tracks dollar-quote state (`$$ … $$`) but not single-quote state (`' … '`). When the scanner hits `--` outside a dollar quote it treats it as an inline comment and skips to EOL — even if the `--` is inside a string literal. Current `db/schema.sql` has no `'...--...'` values, so latent today; any future migration inserting e.g. `'https://foo--bar'`, `'a--b'`, or a note containing `--` would be silently truncated mid-string.
- trigger: add `INSERT INTO flow (id, name) VALUES ('test', 'demo--flow')` to schema.sql, run `npm run db:init` → splitter truncates at `--`, producing `INSERT INTO flow (id, name) VALUES ('test` → parse failure.
- expected vs actual: `--` inside `'...'` preserved as literal characters. Actual: treated as comment start, string truncated.
- dedup: not any prior finding — scripts/ init path was not audited for SQL-string-aware parsing; B10/B11 are verify-db/verify-stripe exit codes, not statement splitting.
- evidence:
    scripts/init-db.ts:46-48  `if (!inDollar && cleaned[i] === "-" && cleaned[i + 1] === "-") { while (i < cleaned.length && cleaned[i] !== "\n") i++; continue; }`  (only `inDollar` tracked; no `inString`)
- test: pure-testable (extract the splitter from main(), fixture with `--` inside `'...'`).
- history: reported 06-23 (#3)

### B38 — `paramSummary` doc/code drift: "first two non-empty fields" vs code that iterates only the first 2 fields by position — MINOR — reported (latent)
- class: type-contract drift / viewer-rendering · location: src/lib/node-summary.ts:11-17 (doc) vs :18-34 (code, esp. :24) · found-by: H5
- symptom: doc promises "Shows the first two non-empty fields" (skip empties, show up to 2 non-empty). Implementation iterates `variant.fields.slice(0, 2)` (first two by position) and skips empties *within that slice*. For any future variant with ≥3 fields where the first two are empty and a later field is populated, the summary renders empty despite a non-empty field existing. None of the 5 current variants has ≥3 fields, so latent today.
- trigger: add a 3-field variant where field[0] and field[1] are cleared but field[2] is set → node card summary empty despite field[2] populated.
- expected vs actual: iterate until 2 non-empty fields collected (per doc). Actual: iterate at most 2 fields, skip empty, return whatever's left.
- dedup: not any prior finding — pure doc-vs-code drift in node-summary.
- evidence:
    src/lib/node-summary.ts:11-17  doc: *"Shows the first two non-empty fields."*
    src/lib/node-summary.ts:24     `for (const field of variant.fields.slice(0, 2)) {`  (positional slice, not "first two non-empty")
- test: pure-testable.
- history: reported 06-23 (#3)

---

### Closed without fix (this hunt)
- none rejected outright — all 5 reports carried file:line evidence and survived dedup.

### Parked (recorded, not fixed — hardening / out of demo scope)
- No change to the existing parked list (credentialRef/node.type length caps, listCommits/listExecLog same-ms tiebreak, updateNodeParam read-merge-write).

---

## Plan for this round

- **Reported 06-23 (#3):** B25–B38 (14 net-new). Convergence: B25 found 4×; B28 found 2×.
- **Top fix cluster (money + run-spine, one source-level decision):** B25 + B26 + B27 together — redesign the run identifier so it is **stable across retries of the same logical run, unique across distinct runs, and independent of the `exec_log` row PK**. Clean shape: client-supplied `runId` → `stripeIdempotencyKey = H(runId:nodeId)`, `execLogId = randomUUID()` (or `H(runId:nodeId:commitId)`). Resolve the branch component against the real `${flowId}-main` id (B26). This also removes the latent double-charge (B27). Pairs with B22 (same executor path). CRIT-eligible under a live key.
- **Editor cluster (all MAJOR, all sonnet-eligible once red tests exist):** B31 (side-panel Number()), B32 (VersionPanel button gate — hoist `running` into the store), B33 (VersionPanel post-Run refetch — subscribe to a versionNonce). These three materially affect the demo; the rest are MINOR hardening.
- **Audit/hygiene tail (MINOR):** B28 (mock-as-success), B29 (Stripe error leak — security-adjacent, do before any live key), B30 (ROLLBACK masking), B34/B35 (effect hygiene), B36 (exec-log branch bleed — pairs with B18), B37/B38 (latent).
- **Still deferred from prior hunts:** B08, B09, B18, B19 (concurrency + branch-scoping cluster).

---

## Hunt 2026-06-23 #4 — docs/SPEC-dashboard.md audit (3 zai hunters, lens-partitioned)

**Artifact under audit:** `docs/SPEC-dashboard.md` (the Dashboard feature spec, 313 lines) — NOT running
code. This hunt finds defects *in the spec* (contradictions, false claims about the existing codebase,
design holes that will become bugs the moment the spec is implemented verbatim). Tree is irrelevant;
scope is the spec document cross-checked against `src/lib/*`, `src/components/editor/*`, `src/app/**`,
`db/schema.sql`, `scripts/*`.

**Fan-out:** 3 `zai` (GLM-5.2) hunters, read-only, one lens each — H1 codebase-coincidence, H2
backend/data-integrity, H3 frontend-lifecycle/edge-case. All three returned full reports. Senior
(glm-5.2) spot-verified the two load-bearing claims (flow-store.ts:77 singleton; editor.tsx
DEMO_FLOW_ID call count = 4 at :44/:68/:80/:81) before recording — both hold.

**Status convention this hunt:** defects carry `reported` with evidence = cited spec line + contradicting
source line (codebase-claim class) or internal logical proof (design class). No code exists to red-test
yet; "proven" here means the cited evidence was verified against source.

Dedup matrix: H2-D1 + H3-#4 → **B39** (2×). H2-D3 + H3-#7 → **B44** (2×). All others unique.
Re-confirmed non-dupes against B01–B38, R01–R09, parked list — all targets are new endpoints/behaviour
introduced by the spec (POST/GET /api/flows, Dashboard, seed-flows.ts, migrate.ts), so no overlap with
existing code bugs. Cross-refs to kin patterns noted per-bug.

---

### B39 — POST /api/flows "server-side idempotent per unique UUID" is false → double-click creates two flows — MAJOR — reported
- class: idempotency / data-duplication · location: SPEC §3.2 line 76 + line 93 · found-by: H2 H3 (2×)
- symptom: the spec claims the create endpoint is safe against double-submit because "Server-side is
  naturally idempotent per unique UUID". But §3.2 line 76 generates the id server-side via
  `crypto.randomUUID()` **on every request** — two requests mint two different ids → two different flow
  rows. There is no client-supplied idempotency key and no uniqueness constraint to dedup. The claim is
  a tautology (the UUID is unique per request, which is exactly why two requests aren't deduped).
- trigger: click the "+" card twice within one React render frame (slow network, inflight state not yet
  armed), or any non-browser client POSTing twice. Two flows persisted with two ids and the same name.
- expected vs actual: either a client idempotency key, or an honest "no server-side idempotency; the
  inflight flag is the only guard". Actual: false claim that the server dedupes.
- note: the frontend guard (§3.2 L93, §4.4 L221 "pointer-events-none while inflight") does not cover the
  race — React `setState({inflight:true})` is async; two clicks in the same tick both dispatch with
  `inflight===false`. Also `pointer-events:none` blocks the mouse but the element stays in the tab order
  → keyboard Enter/Space double-submits (no `aria-disabled`/`tabIndex={-1}`).
- evidence:
    SPEC §3.2 L76  "Generate `id` via `crypto.randomUUID()` …"
    SPEC §3.2 L93  "Server-side is naturally idempotent per unique UUID."
    SPEC §4.4 L221 "Disabled (opacity-50, pointer-events-none) while POST is in-flight"
- kin: same idempotency anti-pattern as the run cluster B23/B25/B27 — idempotency asserted where no
  stable key exists. Different endpoint (flow create vs run), different consequence (duplicate row vs
  duplicate charge). CRIT-eligible the day flow creation has side effects; today it's additive duplication.
- history: reported 06-23 (#4)

### B40 — seed script is NOT idempotent: re-running creates duplicate commits (+ bumps updated_at) — MAJOR — reported
- class: idempotency / data-integrity · location: SPEC §5 lines 251, 272, 274 · found-by: H2 (+ H3 parking)
- symptom: §5 L272 claims the seed is idempotent ("Each `bootstrapFlow` uses `ON CONFLICT DO NOTHING`.
  If flows already exist, the script logs 'already seeded' and exits cleanly"). It is not. `bootstrapFlow`
  is idempotent (ON CONFLICT DO NOTHING), but the seed then calls `saveFlow` and `commitFlow`; `commitFlow`
  does a plain `INSERT INTO "commit" … VALUES ($1,…)` with a caller-supplied commitId and **no ON CONFLICT**
  (flow-repo.ts:357-362). Re-running `npm run db:seed` N times yields N commits per seeded flow. This
  violates §5 L274 ("Each seeded flow gets exactly one commit") and breaks §5 L276's invariant
  ("`createBranch` works (needs a fromCommitId)" — `listCommits` grows on every re-seed). The "logs
  'already seeded' and exits" claim also has no mechanism: `bootstrapFlow` returns `Promise<void>` (§3.1
  L45), so the script cannot detect pre-existence.
- trigger: `npm run db:seed` → run it again → each of seed-stripe/seed-slack/seed-relay gains a 2nd commit;
  3rd run → 3rd commit. (Re-running also re-bumps `updated_at` via §3.4's unconditional UPDATE, so even
  "no new rows" mutates sort order — the dashboard reshuffles after every re-seed.)
- expected vs actual: seed detects pre-existing flows by `SELECT id FROM flow WHERE id = ANY($seed_ids)`
  BEFORE calling commitFlow and skips; or commitFlow gains an idempotency guard. Actual: duplicate
  commits on every re-run, plus the "exits cleanly" detection step is hand-waved.
- evidence:
    SPEC §5 L251 "Use the repo functions directly (`bootstrapFlow`, `saveFlow`, `commitFlow` …)."
    SPEC §5 L272 "Idempotency: Each `bootstrapFlow` uses `ON CONFLICT DO NOTHING`. If flows already
                  exist, the script logs 'already seeded' and exits cleanly."
    SPEC §5 L274 "Each seeded flow gets exactly one commit"
    flow-repo.ts:357-362  commitFlow INSERT, no ON CONFLICT
- history: reported 06-23 (#4)

### B41 — `<Editor key={flowId}>` does NOT reset the Zustand store — the spec's central stale-state fix rests on a false premise — MAJOR — reported
- class: frontend-lifecycle / stale-state · location: SPEC §4.3 lines 196–203 · found-by: H3 · verified by senior
- symptom: §4.3 claims the key remount "Resets Zustand subscriptions (all `useFlowStore` selectors
  re-fire from fresh state)" and concludes "No store reset function needed — the key-based remount is
  simpler and safer than manual cleanup." This is false. `useFlowStore = create<FlowState>(…)` at
  flow-store.ts:77 is a **module-level singleton** (initial `nodes: []`, `edges: []`) — the state lives in
  the module closure, not the React tree. A key change unmounts the *component* and re-subscribes, but
  selectors re-fire against the **same** stale store, returning flow A's nodes/edges/currentBranchId.
  The new Editor mounts → effect sets status:"loading" → awaits `fetchFlow(B)` → during that await the
  canvas renders flow A's graph (visible stale flash). `fromDoc(B)` only overwrites on resolve.
- trigger: dashboard → open flow A (loads, renders) → back → open flow B. Between B's mount and B's fetch
  resolve, flow A's graph is on screen under flow B's header.
- expected vs actual: either zero stale render, or an explicit store `reset()`/`clear()` action called on
  Editor unmount (or mount). Actual (per spec): stale bleed persists; the safety argument ("simpler and
  safer than manual cleanup") is wrong. Today the Save gate (`status==="loading"`) happens to block a
  cross-flow save in the happy path — but that's incidental, not the spec's stated mechanism, and removing
  the gate (or a save during the flash) leaks data across flows.
- note: this is the enabler for B42. Senior confirms flow-store.ts:77 singleton independently of the
  rejected R01 (R01 was a *different* wrong claim about `fromDoc` refiring; the singleton behaviour B41
  relies on is real and is exactly what makes the spec's claim false).
- evidence:
    SPEC §4.3 L196-203  "Render `<Editor key={flowId} … />` … Resets Zustand subscriptions (all
                         `useFlowStore` selectors re-fire from fresh state) … No store reset function
                         needed — the key-based remount is simpler and safer than manual cleanup."
    flow-store.ts:77    `export const useFlowStore = create<FlowState>((set, get) => ({ nodes: [], edges: [], … }))`
    editor.tsx:44-45    `const d = await fetchFlow(…); if (live && d) fromDoc(d);`  (store untouched during await)
- history: reported 06-23 (#4)

### B42 — no not-found screen + PUT auto-creates a missing flow → opening a stale/deleted flow silently resurrects it with a UUID as name (cross-flow data corruption) — CRIT — reported
- class: data-corruption / illegal-state-transition · location: SPEC §4.2 lines 158–161 + §3.4 lines 137–139 · found-by: H3
- symptom: the `Screen` type has no `missing`/`not-found` branch. `fetchFlow` returns `null` on 404
  (flow-client.ts:26) and the editor effect treats null as a no-op (`if (live && d) fromDoc(d)`,
  editor.tsx:45), advancing `status` to "idle" with the store still holding whatever was there
  (B41). So a click on a flowId that no longer exists (deleted out-of-band, DB re-seeded with new ids,
  stale card) lands the user in a blank editor with the Save button enabled. Saving hits PUT → §3.4
  L137-139 `if (branchId === \`${flowId}-main\`) { await bootstrapFlow(c, flowId, name ?? flowId); }`
  → **auto-creates** a brand-new flow row whose `name` is the raw `flowId` string (a UUID), populated
  with whatever stale graph was in the singleton store. Combined with B41 the stale graph can be flow
  A's nodes saved under flow B's id → silent cross-flow data corruption.
- trigger: seed DB → user opens dashboard in tab 1 → DB re-seeded in tab 2 (ids change) → tab 1 still
  shows old cards → click one → blank editor, no error → Save → server creates a new flow row with
  id=UUID, name=UUID (raw), graph = stale in-memory nodes.
- expected vs actual: `Screen` includes a `{view:"editor", flowId, status:"missing"}` branch, or the
  editor renders a not-found panel on `fetchFlow→null` and disables Save. Actual: no terminal state,
  silent blank canvas, then data corruption via auto-bootstrap on PUT.
- evidence:
    SPEC §4.2 L158-161   `type Screen = | { view: "dashboard" } | { view: "editor"; flowId: string };`  (no missing)
    SPEC §3.4 L137-139   `if (branchId === \`${flowId}-main\`) { await bootstrapFlow(c, flowId, name ?? flowId); }`
    flow-client.ts:26    `if (res.status === 404) return null;`
    editor.tsx:44-46     null silently ignored; status advances to "idle".
- history: reported 06-23 (#4)

### B43 — browser-back silently destroys all unsaved canvas edits (no URL state, no beforeunload) — CRIT — reported
- class: data-loss / frontend-lifecycle · location: SPEC §4.1 line 168 + §6 line 284 · found-by: H3
- symptom: with no URL routing (§6 L284), browser-back from the editor does not route to the dashboard —
  it navigates **out of the SPA entirely** (or to the browser default). On return the bundle reloads,
  `useFlowStore` re-inits to `nodes:[]`, `page.tsx` state resets to `{view:"dashboard"}`, and every
  un-saved canvas edit, in-flight branch switch, and run result is gone. The spec marks this "Acceptable
  for demo" (§4.1 L168) without flagging that save is **manual only** (editor.tsx:65-73 onSave, no
  autosave, no dirty-tracking, no `beforeunload`) — so this is silent data loss in a node-graph editor,
  not a benign navigation quirk.
- trigger: user builds a 12-node flow over 20 min → never clicks Save → presses browser-back (or follows
  an external link then returns) → entire graph gone, no warning, no recovery.
- expected vs actual: at minimum a `beforeunload` warning when the canvas is dirty, or autosave-on-blur.
  Actual (per spec L168): "Acceptable for demo" with the data-loss surface never surfaced to the
  implementer.
- evidence:
    SPEC §4.1 L168  "Browser back button: Not handled (no URL state). Acceptable for demo — … explicit trade-off for scope."
    SPEC §6 L284    constraint: no URL routing
    editor.tsx:65-73  save manual only; no dirty-tracking, no beforeunload
- history: reported 06-23 (#4)

### B44 — `ORDER BY f.updated_at DESC` has no tiebreaker → nondeterministic dashboard sort (+ optimistic re-sort) — MAJOR — reported
- class: data-integrity / sort · location: SPEC §3.3 line 116 · found-by: H2 H3 (2×)
- symptom: the dashboard's only job is a sorted card grid, but the GET SQL has no secondary sort key. Two
  flows sharing `updated_at` to the microsecond sort nondeterministically across fetches → cards reshuffle
  on every load. This is near-certain for the 3 seeded flows (§5 bootstraps/saves all three in one tight
  loop, each issuing `UPDATE flow SET updated_at = now()` per §3.4 L141-144). Also breaks optimistic UI:
  the prepend-at-index-0 from §3.2 L91 can land at index ≠ 0 after the next refetch (§4.1 L166) when
  timestamps tie → visible card jump.
- trigger: run §5 seed → reload `/` → the three seeded cards reorder. Or create a flow, open another and
  back (dashboard remounts/refetches) → if the new flow ties another's `updated_at`, it re-sorts.
- expected vs actual: `ORDER BY f.updated_at DESC, f.id DESC` (mirroring the codebase's own listCommits
  tiebreak at flow-repo.ts:402, whose comment at :390-392 explicitly justifies `id DESC` under exactly
  this "same-ms collision" reasoning). Actual: relies on `updated_at` being unique, which it is not.
- evidence:
    SPEC §3.3 L116      `ORDER BY f.updated_at DESC`
    SPEC §3.2 L91       "optimistically prepend the card without refetching"
    flow-repo.ts:402    `ORDER BY created_at DESC, id DESC`  (the project already knows better)
    flow-repo.ts:390-392 comment justifying the id tiebreak
- kin: parked-list item "listCommits/listExecLog same-ms tiebreak" — the spec repeats a known anti-pattern
  the codebase already fixed elsewhere.
- history: reported 06-23 (#4)

### B45 — seed composes 3 separate transactions + `bootstrapFlow` is not exported → partial-failure leaves 0 commits, and the script won't compile as written — MAJOR — reported
- class: transaction-boundary / data-integrity · location: SPEC §5 lines 251, 274, 276 + §3.1 line 41 · found-by: H2
- symptom: §5 L251 says the seed "Use[s] the repo functions directly (`bootstrapFlow`, `saveFlow`,
  `commitFlow`)". These are three functions that each manage their OWN transaction (flow-repo.ts:110-154
  saveFlow txn, :311-386 commitFlow txn) — not one outer transaction. If `commitFlow` fails after
  `saveFlow` succeeds (e.g. its "empty" guard at flow-repo.ts:352-355 fires because the seed's
  `GraphDocument` wrote nothing, or any DB blip), the seeded flow is left with **0 commits** —
  contradicting §5 L274 ("exactly one commit") and silently breaking §5 L276 ("`createBranch` works
  (needs a fromCommitId)"): opening the version panel and clicking "branch" 404s because
  `head_commit_id` is NULL. Separately, `bootstrapFlow` as defined in §3.1 is `async function
  bootstrapFlow(` — **no `export`** — so `import { bootstrapFlow } from "@/lib/flow-repo"` in the seed
  fails to compile; the spec never tells the implementer to export it.
- trigger: (a) transient DB error mid-seed → flow row exists, 0 commits, dashboard shows a flow that
  crashes the version panel. (b) implement the seed verbatim → `import { bootstrapFlow }` is a compile
  error, or the implementer reinlines the bootstrap (re-introducing the FK-ordering bugs §5 L251 claims
  to avoid).
- expected vs actual: seed wraps all three steps in a single BEGIN…COMMIT on one PoolClient (the pattern
  used by every other fn in flow-repo.ts), AND §3.1 adds `export` to `bootstrapFlow`. Actual: three
  independent transactions, no export specified.
- evidence:
    SPEC §5 L251    "Use the repo functions directly (`bootstrapFlow`, `saveFlow`, `commitFlow` …)."
    SPEC §3.1 L41   `async function bootstrapFlow(`  (no export)
    flow-repo.ts:352-355  commitFlow "empty" guard can ROLLBACK leaving 0 commits
- history: reported 06-23 (#4)

### B46 — §2.2 vs §3.4 CONTRADICTION on how `updated_at` is bumped — MAJOR — reported
- class: self-contradiction / data-integrity · location: SPEC §2.2 lines 22–30 vs §3.4 lines 135–145, §3.1 line 50 · found-by: H2
- symptom: §2.2 documents an updated_at bump "inside the `ON CONFLICT ... DO UPDATE` clause" and quotes:
  `ON CONFLICT (id) DO UPDATE SET default_branch_id = …, updated_at = now()`. But §3.4 replaces the
  inline upsert with a call to `bootstrapFlow`, whose flow INSERT is `ON CONFLICT (id) DO NOTHING`
  (§3.1 L50) — touching neither `default_branch_id` nor `updated_at` on conflict. §3.4 then bumps
  `updated_at` via a **separate** `UPDATE flow SET updated_at = now() WHERE id = $1` (L141-144). So the
  §2.2 SQL clause is neither the current behaviour (flow-repo.ts:128 has no `updated_at` — the column
  doesn't exist yet) nor the post-§3.4 behaviour. It is imaginary. An implementer reading top-to-bottom
  writes the §2.2 clause, then §3.4 tells them to delete it.
- trigger: any engineer implementing the spec in order.
- expected vs actual: §2.2 describes the same mechanism §3.4 implements (separate UPDATE after
  bootstrapFlow). Actual: §2.2 quotes SQL that §3.4 removes.
- evidence:
    SPEC §2.2 L22-27   "Bumped inside `saveFlow()` on the existing `ON CONFLICT ... DO UPDATE` clause:"
                       + `ON CONFLICT (id) DO UPDATE SET default_branch_id = …, updated_at = now()`
    SPEC §3.4 L137-138 `if (branchId === \`${flowId}-main\`) { await bootstrapFlow(…); }`
    SPEC §3.1 L50      `ON CONFLICT (id) DO NOTHING`  (no updated_at on conflict)
    SPEC §3.4 L141-144 `UPDATE flow SET updated_at = now() WHERE id = $1`  (the real bump, absent from §2.2)
    flow-repo.ts:128   current `ON CONFLICT (id) DO UPDATE SET default_branch_id = …` (no updated_at)
- history: reported 06-23 (#4)

### B47 — `bootstrapFlow` `ON CONFLICT (id) DO NOTHING` silently drops the current `default_branch_id` re-pointing → dashboard `nodeCount` reads 0 forever for drifted flows — MAJOR — reported
- class: data-integrity / silent-regression · location: SPEC §3.1 lines 47–58 + §3.3 line 119 · found-by: H2
- symptom: current `saveFlow` (flow-repo.ts:128) re-points `default_branch_id` to `${flowId}-main` on
  every save via `ON CONFLICT (id) DO UPDATE SET default_branch_id = EXCLUDED.default_branch_id`.
  §3.1's `bootstrapFlow` switches to `ON CONFLICT (id) DO NOTHING` — so on a repeat save it preserves
  `default_branch_id` AND `name` as-is, never repairing drift. If a flow's `default_branch_id` ever
  points elsewhere (manual SQL, a future "set default branch" feature, a migration that creates flows
  without it, or a non-main-branch save where the guard at §3.4 L137 skips bootstrapFlow entirely),
  subsequent saves will NOT re-point it. §3.3's nodeCount subquery `WHERE branch_id = f.default_branch_id`
  then silently returns 0 for that flow forever, while the live graph lives under a different branch.
  §3.3 L119 asserts `default_branch_id` is "never NULL" without noting nothing keeps it pointed at a
  branch with live nodes.
- trigger: flow `X` exists with `default_branch_id='X-custom'` (admin repointed default) → user saves →
  `bootstrapFlow` flow INSERT does NOTHING, branch INSERT creates orphan `X-main`, `UPDATE … updated_at`
  runs but doesn't touch default_branch_id → dashboard shows `X` with nodeCount:0 even though `X-custom`
  has 20 nodes.
- expected vs actual: either §3.1 acknowledges "we no longer re-point default_branch_id on save"
  (deliberate regression), or it re-points it (matching flow-repo.ts:128). Actual: silently drops the
  re-pointing with no callout.
- evidence:
    SPEC §3.1 L48-51  `INSERT INTO flow (…) VALUES ($1,$2,$3,now()) ON CONFLICT (id) DO NOTHING`
    SPEC §3.3 L119    "default_branch_id is never NULL for flows created via bootstrapFlow (always set)."
    flow-repo.ts:128  `ON CONFLICT (id) DO UPDATE SET default_branch_id = EXCLUDED.default_branch_id`
- kin: B24 (branch-name ambiguity) — both are branch-identity-ambiguity defects; different mechanism.
- history: reported 06-23 (#4)

### B48 — dashboard "refetch on return" is asserted but the render guard it depends on is never specified — MAJOR — reported
- class: frontend-lifecycle / stale-state · location: SPEC §4.1 line 166 · found-by: H3
- symptom: §4.1 L166 asserts "since Dashboard unmounts when entering editor, it refetches on every
  return." But the spec never specifies the page.tsx render guard that makes this true. Current page.tsx
  (page.tsx:10-12) renders `<Editor/>` with no screen state at all. If the implementer writes
  `{view === "dashboard" ? <Dashboard/> : <Editor key={flowId}/>}` the unmount holds; if they keep both
  mounted and toggle a `hidden` class (a common pattern to preserve scroll), the Dashboard's `useEffect`
  does NOT re-run on return → stale cards until manual refresh. The spec leaves this load-bearing detail
  unspecified while depending on it.
- trigger: implementer keeps Dashboard mounted to preserve scroll across editor trips → returns from
  editor → flow list is the pre-trip snapshot (does not reflect edits/creates from another tab).
- expected vs actual: spec mandates the conditional render (or specifies a re-fetch signal in the screen
  state). Actual: behaviour is implementation-defined; the spec's claim can silently fail.
- evidence:
    SPEC §4.1 L166  "since Dashboard unmounts when entering editor, it refetches on every return."
    page.tsx:10-12  current code has no `view` state; spec describes unimplemented behaviour without the guard.
- history: reported 06-23 (#4)

### B49 — §7 "Retry" button has no defined re-fetch trigger → dead button — MAJOR — reported
- class: frontend-lifecycle / error-recovery · location: SPEC §7 line 300 + §4.1 line 166 · found-by: H3
- symptom: §7 says show a "Retry" button on fetch failure; §4.1 says the fetch lives in `useEffect` on
  mount. A naive Retry handler that does `setError(null)`/`setLoading(true)` does NOT re-run the mount
  effect — deps unchanged. The spec never says whether Retry (a) calls the fetch fn directly, (b) bumps
  a nonce in state that's in the deps array, or (c) remounts via a key bump. Without one of those, Retry
  is a dead button.
- trigger: disconnect network → load dashboard → "Failed to load flows" → reconnect → click Retry → nothing happens.
- expected vs actual: spec specifies the re-fetch mechanism. Actual: unspecified; common bug surface.
- evidence:
    SPEC §7 L300    "Dashboard shows a simple 'Failed to load flows' message with a 'Retry' button on fetch failure."
    SPEC §4.1 L166  fetch is in useEffect on mount only; no nonce/state specified.
- history: reported 06-23 (#4)

### B50 — editor.tsx `DEMO_FLOW_ID` call count is 4, not 3 — MAJOR — reported
- class: codebase-coincidence (spec-accuracy) · location: SPEC §4.2 line 186 vs editor.tsx:44,68,80,81 · found-by: H1 · verified by senior
- symptom: spec's refactor checklist says editor.tsx has "fetchFlow, saveFlowToServer, runFlow (3 calls)".
  It undercounts: `saveFlowToServer(DEMO_FLOW_ID,…)` appears TWICE — :68 in `onSave` and :80 in `onRun` —
  plus `fetchFlow` (:44) and `runFlow` (:81) = 4 call sites. An implementer trusting "3" may leave one
  call on `DEMO_FLOW_ID` (the refactored editor then saves/runs against the demo flow for one path).
- expected vs actual: "4 calls (saveFlowToServer ×2)". Actual: "3".
- evidence:
    SPEC §4.2 L186  "| `editor.tsx` | fetchFlow, saveFlowToServer, runFlow (3 calls) | Use `props.flowId` |"
    editor.tsx:44   `await fetchFlow(DEMO_FLOW_ID, currentBranchId);`
    editor.tsx:68   `await saveFlowToServer(DEMO_FLOW_ID, toDoc(), currentBranchId);`  (onSave)
    editor.tsx:80   `await saveFlowToServer(DEMO_FLOW_ID, toDoc(), currentBranchId);`  (onRun)
    editor.tsx:81   `setRunResult(await runFlow(DEMO_FLOW_ID, currentBranchId));`
- history: reported 06-23 (#4)

### B51 — version-panel.tsx refactor list is wrong: lists `diffFlow` (not called), omits `saveFlowToServer` (called at :75) — MAJOR — reported
- class: codebase-coincidence (spec-accuracy) · location: SPEC §4.2 line 187 vs version-panel.tsx:75,217 · found-by: H1 · verified by senior
- symptom: spec lists the functions to update as "listCommits, commitFlow, rollbackFlow, **diffFlow**,
  listBranches, createBranch". `diffFlow()` is NOT invoked in version-panel.tsx — the only diff reference
  is `flowId={DEMO_FLOW_ID}` passed as a prop to `<DiffView>` at :217 (DiffView is a separate component).
  Meanwhile `saveFlowToServer(DEMO_FLOW_ID, doc, currentBranchId)` IS called at :75 (inside `onCommit`)
  but is OMITTED from the spec's list.
- expected vs actual: list `saveFlowToServer` (:75) and drop `diffFlow` (or restate as "DiffView flowId
  prop at :217"). Actual: sends the implementer looking for a `diffFlow(...)` call that doesn't exist and
  lets them miss :75 (which then keeps hardcoding the demo flow inside onCommit).
- evidence:
    SPEC §4.2 L187       "| `version-panel.tsx` | listCommits, commitFlow, rollbackFlow, diffFlow, listBranches, createBranch (~10 calls) | … |"
    version-panel.tsx:75 `await saveFlowToServer(DEMO_FLOW_ID, doc, currentBranchId);`  (present, not listed)
    version-panel.tsx:217 `flowId={DEMO_FLOW_ID}`  (only diff reference; no `diffFlow(` call exists)
- history: reported 06-23 (#4)

### B52 — exec-log-viewer.tsx has 1 `listExecLog` call, not 2 — MAJOR — reported
- class: codebase-coincidence (spec-accuracy) · location: SPEC §4.2 line 188 vs exec-log-viewer.tsx:17 · found-by: H1 · verified by senior
- symptom: spec claims "listExecLog (2 calls)". There is exactly one invocation, :17 (the 2nd `rg` hit is
  the import at :6).
- expected vs actual: "1 call". Actual: "2".
- evidence:
    SPEC §4.2 L188          "| `exec-log-viewer.tsx` | listExecLog (2 calls) | Accept `flowId` as prop from Editor |"
    exec-log-viewer.tsx:17  `listExecLog(DEMO_FLOW_ID)`  (sole call; :6 is the import)
- history: reported 06-23 (#4)

### B53 — 3 of 4 listed test files do NOT render `<Editor/>`; the prescribed fix applies to only 1 — MAJOR — reported
- class: codebase-coincidence (spec-accuracy) · location: SPEC §4.2 line 190 vs version-panel.test.tsx:111, version-panel.bugs.test.tsx:51, exec-log-viewer.test.tsx:52 · found-by: H1
- symptom: spec asserts all four test files "Render `<Editor/>` without props" and prescribes "Pass
  `flowId='test-flow'` + `onBack={vi.fn()}`". Only `editor.test.tsx` renders `<Editor/>`. The other three
  render their OWN component directly — `version-panel.test.tsx` and `version-panel.bugs.test.tsx` render
  `<VersionPanel/>`; `exec-log-viewer.test.tsx` renders `<ExecLogViewer/>`. None mounts `<Editor/>`, so
  `onBack` is irrelevant to them and `VersionPanel`/`ExecLogViewer` currently take no props.
- expected vs actual: only editor.test.tsx renders `<Editor/>`; the other three render their panel/viewer
  directly and would need a `flowId` prop on that specific component (not `onBack`). Actual: the fix is
  wrong for 3/4 files.
- evidence:
    SPEC §4.2 L190                "| Tests (editor.test.tsx, version-panel.test.tsx, exec-log-viewer.test.tsx, version-panel.bugs.test.tsx) | Render `<Editor/>` without props … | Pass `flowId='test-flow'` + `onBack={vi.fn()}` |"
    version-panel.test.tsx:111     `render(<VersionPanel />);`
    version-panel.bugs.test.tsx:51 `render(<VersionPanel />);`
    exec-log-viewer.test.tsx:52    `render(<ExecLogViewer />);`
- history: reported 06-23 (#4)

### B54 — date-bucket logic is timezone-nondeterministic; `Intl.RelativeTimeFormat` mention is dead — MINOR — reported
- class: frontend-lifecycle / TZ-edge · location: SPEC §4.4 lines 230–234 · found-by: H3
- symptom: `updatedAt` is a UTC ISO string (`.000Z`, §3.2 L86 / §3.3 L105). The buckets "Today at HH:MM" /
  "Yesterday" compare the flow's date to now via `new Date(iso).getDay()` etc., which run in the viewer's
  LOCAL timezone — so the bucket boundary is local-midnight against a UTC instant. A flow saved at 23:30
  UTC is "Today at 04:30" to a +05:00 viewer but still the previous UTC day → bucket label and formatted
  clock disagree across viewers; around UTC midnight the same instant lands in different buckets for
  different TZs. Also `Intl.RelativeTimeFormat` is named at L230 but its outputs ("yesterday", "2 days
  ago") don't match the manual bucket strings ("Yesterday", "Jun 12") → unused import (lint risk) or
  speculative mention with no usage.
- trigger: two users in different TZs view the same flow → different bucket labels.
- expected vs actual: spec specifies UTC vs local for the bucket boundary, or uses
  `Intl.RelativeTimeFormat` consistently. Actual: implicitly local-midnight vs UTC instant; dead API mention.
- evidence:
    SPEC §4.4 L230-234  buckets listed; no TZ specified.
    SPEC §3.2 L86, §3.3 L105  `updatedAt` is `.000Z` (UTC ISO).
    SPEC §4.4 L230     "Use `Intl.RelativeTimeFormat` + manual bucket logic (no library)"  (incompatible output shapes)
- history: reported 06-23 (#4)

### B55 — flow-card name truncates with no `title`/tooltip → long names unreadable (and un-renameable) — MINOR — reported
- class: a11y / viewer · location: SPEC §4.4 lines 223–228 · found-by: H3
- symptom: card spec is `text-sm font-medium, single line, truncate` (L225), no `title`/tooltip. The
  card's entire visible content is name + date. A ≤100-char name (§3.2 L73 admits it) truncates to ~30
  chars with no way to read the full name — no rename path (non-goal §8 L307) and no detail view from the
  dashboard (click-to-open only, §6 L287).
- trigger: create a flow with a 60+ char name → return to dashboard → truncated, unreadable.
- expected vs actual: `title={name}` or a shadcn Tooltip. Actual: unreadable truncated text.
- evidence:
    SPEC §4.4 L225  "Flow name: `text-sm font-medium`, single line, `truncate`"  (no title)
    SPEC §8 L307    renaming is a non-goal
    SPEC §6 L287    click-to-open only, no detail view
- history: reported 06-23 (#4)

### B56 — spec claims `crypto.randomUUID()` is "the existing pattern"; the codebase actually uses `randomUUID()` from `node:crypto` — MINOR — reported
- class: codebase-coincidence (spec-accuracy) · location: SPEC §3.2 line 76 + §6 line 288 vs commit/route.ts:1,35 · found-by: H1
- symptom: spec says "Generate `id` via `crypto.randomUUID()` (already used elsewhere …)" (L76) and
  "`crypto.randomUUID()` for all ID generation (already the pattern in route handlers)" (L288). Every
  existing route handler imports the standalone fn: `import { randomUUID } from "node:crypto"` and calls
  `randomUUID()`. There is zero usage of the global `crypto.randomUUID()` form in the repo. The "no new
  deps" conclusion is correct; the justification ("already the pattern") is false.
- expected vs actual: "use `randomUUID()` from `node:crypto` (the existing route-handler pattern)" or
  drop the "already the pattern" claim. Actual: cites a pattern that doesn't exist.
- evidence:
    SPEC §3.2 L76   "Generate `id` via `crypto.randomUUID()` (already used elsewhere in the project …)."
    SPEC §6 L288    "`crypto.randomUUID()` for all ID generation (already the pattern in route handlers)."
    commit/route.ts:1,35  `import { randomUUID } from "node:crypto";` → `const commitId = randomUUID();`
    (same idiom in run/rollback/branches routes; `rg "crypto\.randomUUID"` → no hits)
- history: reported 06-23 (#4)

---

### Patterns (this hunt)

- **P-SPEC-1 — "spec asserts existing-codebase facts without verification". Members: B50, B51, B52, B53,
  B56 (all `codebase-coincidence`).** The spec's refactor checklist and "already the pattern" claims were
  written from memory, not from grepping the tree. Repair (one source-level decision): every concrete
  claim about existing code (line numbers, signatures, call counts, "currently does X", "already used
  elsewhere", "new file") must be re-verified against the tree before the spec is marked ready — same
  discipline as the verify-before-commit rule in AGENTS.md. Contract check: a `rg` snippet under each
  claim.
- **P-SPEC-2 — "idempotency claimed where no stable key exists". Members: B39 (server idempotent per
  UUID), B40 (seed idempotent).** Kin to the run cluster B23/B25/B27. Same anti-pattern: the spec says
  "idempotent" because an `ON CONFLICT` or a unique value appears somewhere, without checking that the
  conflict key is stable across the retry shape that actually occurs. Repair: define idempotency by the
  actual stable conflict key (client-supplied runId / pre-existing-flow detection), not by "a unique
  value exists in the request".

---

### Closed without fix (this hunt)
- none rejected outright — all three hunters cited both the spec line and (where applicable) the
  contradicting source line; the two load-bearing source claims (flow-store.ts:77 singleton, editor.tsx
  call count) were senior-verified before recording.

### Parked (recorded, not fixed — design opinion / out of demo scope)
- §2.1 introduces a brand-new `db/migrations/` + `migrate.ts` track alongside the existing one-shot
  `init-db.ts` (full-drop-and-recreate). The relationship between the two schema-management models going
  forward is unspecified (H2 parking). Design decision, not a defect.
- §3.2 POST response `updatedAt` (L86) has no defined source: `bootstrapFlow` returns void (§3.1 L45), so
  the route must either follow up with `SELECT updated_at …` in the same txn or fake `new Date().toISOString()`
  (drifts from DB `now()` by ms). Unspecified (H2 parking).
- §3.3 `default_branch_id` NULL → count silently 0; schema (db/schema.sql:8) doesn't enforce NOT NULL and
  migration 001 (§2.1 L15) only adds the column, no constraint/backfill (H2 parking). Acknowledged in
  spec L119 but ships no fix.

---

## Plan for this round

- **Reported 06-23 (#4):** B39–B56 (18 net-new spec defects). Convergence: B39 found 2×, B44 found 2×.
- **Must-fix before implementation (CRIT, silent data loss/corruption):** B42 (not-found → PUT resurrects
  a garbage flow; pairs with B41) and B43 (browser-back loses unsaved work). Both need a spec revision,
  not code.
- **Spec self-correction cluster (revise the document, then implement):** B46 (§2.2 vs §3.4 contradiction),
  B40 + B45 (seed idempotency + transaction boundary + missing export), B47 (bootstrapFlow drops
  default_branch_id re-pointing), B44 (sort tiebreaker), B39 (drop the false idempotency claim). These
  six are blockers for a correct implementation.
- **Refactor-checklist accuracy cluster (5 MINOR/MAJOR, trivial spec edits):** B50–B53, B56 — re-verify
  against the tree and correct the counts/lists. Low effort, prevents implementer missteps.
- **Frontend-design gaps (spec should specify):** B48 (refetch render guard), B49 (Retry trigger), B54
  (TZ buckets), B55 (card tooltip). Specification gaps, not yet code.
- **Still deferred from prior hunts:** B08, B09, B18, B19 (concurrency + branch-scoping cluster).
