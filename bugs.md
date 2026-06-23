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

## Plan for this round

- **Fix now, Opus (data integrity at the API boundary, one owner for route.ts + contract.ts):** B01, B02, B03, B04, B05, B06, B07.
- **Fix now, sonnet (easy, single-file, serial):** B12 + B13 (editor.tsx); B11 (verify-db.ts).
- **Deferred, recommended top follow-up:** B08, B09 (concurrency — pair them, FOR UPDATE + read transaction).
- **Deferred to Rung 4/6 (owns condition + trigger semantics):** B14, B15, B16.
- **Record only:** B10 (Stripe, not-test-verifiable, Rung 4).
- Every shipped fix lands with its red→green test (B11 is the script exception: manual verify).
