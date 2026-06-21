# Visual Automation Builder — Build Spec (H0)

*The execute-from document for two builders. Turns `roadmap-spec-ready.md` into concrete schema, contracts, algorithms, components, acceptance criteria, and an 8-day plan. Grounded in `h0-hackathon-research.md` + `h0-judges.md`. Hardened against two waves of adversarial critique.*

> **Deadline:** June 29, 2026, 17:00 PDT (drives the §9 build schedule). **Demo cut line: rungs 3 + 5 working on the real stack.**

---

## 0. Decisions Locked (read first)

| # | Decision | Choice | Why (one line) |
|---|----------|--------|----------------|
| 1 | **Backend architecture** | **balanced-A** — TS everywhere; Next.js on Vercel ↔ Aurora direct; **one AWS Lambda** = "consequence engine" for irreversible actions | Both sponsors used heavily where it *scores*; fewest moving parts for 8 days; the Lambda makes the honesty thesis architecturally literal |
| 2 | **Version storage** | **Snapshot per commit** — each commit stores the full graph as JSONB ("photos") | Simple, instant read, unbreakable on a deadline; one snapshot ≈ 5 KB, ~500 MB at 100 commits × 1k flows — range-partition by `flow_id` later |
| 3 | **Diff depth** | **Field-level** — node/edge add/remove/modify **+ per-param `before → after`** | The money shot of the demo is the app pointing at `amount: 100 → 90` |
| 4 | **Auth / tenancy** | **None** — single hardcoded demo workspace, no `user`/`org` columns | Judges score versioning magic, not a login screen |
| 5 | **Exec-log immutability** | **DB-level** — least-priv `app_role` with `REVOKE UPDATE/DELETE/TRUNCATE` + row-and-statement triggers | "The database forbids it, not us." Demo scope covers `app_role`; superuser/owner is out of scope (run the live proof *as* `app_role`) |

**Non-negotiables:** reach rung 3 (the star) and rung 5 (the honesty climax) on the real stack. Everything above rung 5 is the believable "and here's where it goes."

---

## 1. Architecture (balanced-A)

```
 VERCEL  (Next.js App Router)                       AWS
 ┌─────────────────────────────┐         ┌────────────────────────────────────┐
 │ /app        canvas (React    │         │ Aurora PostgreSQL (Serverless v2)  │
 │             Flow) + UI       │  OIDC + │   • commit.graph_snapshot (JSONB)  │
 │ /app/api/*  Route Handlers   │◄──IAM──►│   • node/edge/node_view (live copy)│
 │   = version-control API +     │  (Mktpl │   • exec_log (append-only, DB-      │
 │     graph INTERPRETER         │  integ.)│      enforced immutable)           │
 │                              │         │                                    │
 │  irreversible ACTION node  ──┼────────►│ Lambda "consequence engine"        │
 │                              │         │   reads cred ► Secrets Manager/KMS │
 │                              │         │   calls Stripe (test) ► writes log │
 └─────────────────────────────┘         │ IAM: scoped role (draft can't reach│
                                          │      a live credential)            │
                                          └────────────────────────────────────┘
```

- **Vercel** = the version-control surface + the **graph interpreter**: canvas, branch/diff/rollback, CRUD API, and walking the graph all run as Route Handlers. Only an **irreversible action node** (e.g. `action.stripe.charge`) is dispatched to the Lambda — the interpreter itself is *not* a separate service.
- **AWS** = the system of record (graph + versions + immutable log) **and the place where irreversible consequences happen** (the Lambda).
- **Connection:** native Vercel↔Aurora Marketplace integration — Vercel OIDC is exchanged for AWS creds, which mint a short-lived **RDS IAM auth token**; the connection is made as a **pre-created Postgres user granted `rds_iam`** (mapped to `app_role`), no password in env.
- **Aurora Serverless v2** scales to **0 ACUs** when idle (auto-pause, ~15 s resume). ⚠️ For the LIVE demo, set a **non-zero minimum ACU** so the first query doesn't eat a cold-start on stage.
- **The narrative the diagram sells:** roll back the definition on the Vercel side all you want — the charge fired inside AWS Lambda and is logged immutably in Aurora. You cannot un-fire it.

`★ Insight ─────────────────────────────────────`
The single Lambda is not overhead — it *is* the climax. Putting the irreversible action behind a scoped IAM role means the Vercel/draft side **physically cannot** reach the Stripe secret. That's "draft/prod isolation by capability, not convention" made real, and it's exactly the kind of detail this DB/infra panel rewards.
`─────────────────────────────────────────────────`

**Ownership:** Backend/hardening owner = Aurora schema, interpreter, diff engine, Lambda, vault, immutability. Frontend/canvas owner = React Flow canvas, palette, side-panel, version bar, diff view, exec-log viewer.

---

## 2. The Data Contract (the spine — freeze together at Sync 0)

Shared TypeScript, imported by both front and back (`lib/contract.ts`). **Neither side edits this alone.**

### 2.1 Graph document — two layers, linked by stable node ID

```ts
// ---- Logic layer (what runs) ----
export type NodeType =
  | "trigger.schedule" | "trigger.webhook"
  | "action.stripe.charge" | "action.slack.post"
  | "condition.if";

export interface GraphNode {
  id: string;                       // stable, client-generated (nanoid). Survives across commits → diff anchors on it.
  type: NodeType;
  params: Record<string, unknown>;  // per-type config. NEVER put a raw secret/token here — use credentialRef.
                                    //   Enforced by a per-type zod allowlist at the API boundary (see §2.5).
  credentialRef?: string;           // opaque vault id — NEVER a raw secret
  isDraftSafe: boolean;             // false for action.stripe.charge
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  condition?: string;               // optional guard expression, e.g. "true" / "false" branch label
}

// ---- Presentation layer (where it sits) ----
export interface NodeView {
  nodeId: string;                   // same id as the logic node
  x: number; y: number;
  width: number; height: number;
  color?: string;
}

// ---- What canvas <-> API actually exchange ----
export interface GraphDocument {
  nodes: GraphNode[];
  edges: GraphEdge[];
  views: NodeView[];
}
```

`★ Insight ─────────────────────────────────────`
Two layers keyed by the same `id` is the whole reason the split works: moving a block (a `view` change) and editing its logic (a `node` change) are different classes of change that can never collide. The diff engine deliberately **ignores `views`** — so "I dragged the box" never shows up as "the flow changed." (This is a *separation*, not a multi-branch merge algorithm — see §10.)
`─────────────────────────────────────────────────`

### 2.2 Version envelope

```ts
export interface Commit {
  id: string;                       // server-generated nanoid — NOT a content hash, so re-rolling
                                    //   back to an identical state is always a fresh commit (no PK clash).
                                    //   Stored as column `commit.graph_snapshot` (supersedes the roadmap's `graphSnapshotRef`).
  flowId: string;
  branchId: string;
  parentId: string | null;          // DAG
  authorNote: string;
  createdAt: string;                // ISO
  graphSnapshot: GraphDocument;     // FULL snapshot — decision #1 ("photos")
}

export interface Branch {
  id: string;
  flowId: string;
  name: string;
  headCommitId: string | null;
  baseCommitId: string | null;
}
```

### 2.3 Diff (field-level — decision #3) & Exec log

```ts
export interface FieldChange { field: string; before: unknown; after: unknown; }

export interface GraphDiff {
  nodes: {
    added: GraphNode[];
    removed: GraphNode[];
    modified: { id: string; type: NodeType; fieldChanges: FieldChange[] }[];
  };
  edges: {
    added: GraphEdge[];
    removed: GraphEdge[];
    modified: { id: string; fieldChanges: FieldChange[] }[];
  };
  // NOTE: views are never diffed.
}

export interface ExecLogEntry {
  id: string;                       // nanoid; also used as the Stripe Idempotency-Key (see §6.2)
  flowId: string;
  commitId: string;                 // which version was live when this ran
  nodeId: string;
  actionType: NodeType;
  request: Record<string, unknown>; // secret-free (credentialRef only, never the resolved secret)
  response: Record<string, unknown>;
  status: "success" | "failure";
  createdAt: string;
  // prevHash?/rowHash? — hash-chain is an optional stretch; NOT in the demo DDL (§3).
}
```

### 2.4 API surface (Next.js Route Handlers)

| Method & path | Body | Returns | Behavior |
|---|---|---|---|
| `POST /api/flows` | `{name}` | `{flow, branch}` | Insert sequence: `flow` (null `default_branch_id`) → `branch` → `UPDATE flow.default_branch_id` → initial empty commit. One transaction. |
| `GET /api/flows/:id` | — | `{flow, branches, head: GraphDocument}` | Load flow + live head graph |
| `PUT /api/flows/:id/branches/:bid/graph` | `GraphDocument` | `{ok}` | Autosave: upsert live `node`/`edge`/`node_view`. Writes **only** live tables — **never** commit history. Last-write-wins, no concurrency control (single-user demo). |
| `POST /api/flows/:id/branches/:bid/commit` | `{authorNote}` | `Commit` | Read live graph → INSERT commit w/ snapshot → advance `head_commit_id`. **All in one transaction.** |
| `POST /api/flows/:id/branches` | `{fromCommitId, name}` | `Branch` | Fork: INSERT branch → load snapshot → bulk-insert live **nodes, then edges, then views**. **One transaction; rollback on any error** (no half-forked branch). |
| `GET /api/flows/:id/diff?from=&to=` | — | `GraphDiff` | `from`/`to` are commit ids (any branch of this flow). Server loads each `graph_snapshot`, calls `diffGraph`. `400` if an id is unknown or from a different `flow_id`. |
| `POST /api/flows/:id/branches/:bid/rollback` | `{toCommitId}` | `Commit` | Load snapshot into live tables **and** INSERT a new commit recording the rollback. **All in one transaction.** |
| `POST /api/flows/:id/branches/:bid/run` | `{fromNodeId?}` | `{entries: ExecLogEntry[]}` | Interpret the graph (§6.1). `MOCK_MODE` skips the Lambda and returns a `mock_`-prefixed charge id; either way **always** appends to `exec_log`. |
| `GET /api/flows/:id/execlog` | — | `ExecLogEntry[]` | Append-only log (the climax screen). Read-only. |

> **Rollback is itself a commit.** History never loses the fact that you rolled back — honest, and it reads well to the panel.
> **Credentials (vault):** no credential CRUD in demo scope. Seed one secret by hand (§6.3); the SidePanel picker reads a hardcoded list `[{id:'demo/stripe-test', label:'Stripe test key'}]`.

### 2.5 Per-type param schemas (drive validation + SidePanel)

One zod schema per `NodeType` — the allowlist that keeps secrets out of `params` (§2.1) **and** the config that generates `<SidePanel>` forms generically (§5, one renderer for five types).

```
trigger.webhook       {}                                   // payload comes from the inbound request
trigger.schedule      { cron: string }
condition.if          { expression: string }               // e.g. "plan == 'pro'"
action.stripe.charge  { amount: number, currency: string } // credential via credentialRef, NOT params
action.slack.post     { channel: string, message: string } // credential via credentialRef, NOT params
```

---

## 3. Aurora PostgreSQL schema (DDL)

Hybrid by design — **JSONB snapshots for immutable history** (fast whole-flow load) **+ normalized live tables for the editable head** (FK integrity, joins, structural diff). This duality is the answer to "why not DynamoDB / why not DSQL."

```sql
-- decision #4: single demo workspace — NO users/orgs.

create table flow (
  id                text primary key,
  default_branch_id text,        -- set after branch exists (see POST /flows insert sequence, §2.4)
  name              text not null,
  created_at        timestamptz not null default now()
);

create table branch (
  id             text primary key,
  flow_id        text not null references flow(id),
  name           text not null,
  head_commit_id text,        -- soft pointer; commit↔branch is circular, resolved by app-level write
  base_commit_id text         --   ordering (a DEFERRABLE FK is the production hardening)
);

create table commit (
  id             text primary key,                 -- nanoid (not a content hash)
  flow_id        text not null references flow(id),
  branch_id      text not null references branch(id),
  parent_id      text references commit(id),       -- DAG
  author_note    text not null default '',
  created_at     timestamptz not null default now(),
  graph_snapshot jsonb not null                    -- FULL snapshot ("photos")
);
-- GIN supports containment queries, e.g. "commits containing a stripe.charge node":
--   where graph_snapshot @> '{"nodes":[{"type":"action.stripe.charge"}]}'
-- Unused by the demo's PK-only reads; kept for the "and here's where it goes" story.
create index commit_snapshot_gin on commit using gin (graph_snapshot);
create index commit_branch_idx  on commit (branch_id, created_at desc);

-- LIVE working copy of each branch head (normalized → FK integrity, joins, the relational story)
create table node (
  id             text not null,
  branch_id      text not null references branch(id),
  type           text not null,
  params         jsonb not null default '{}',
  credential_ref text,                              -- opaque vault id, never a secret
  is_draft_safe  boolean not null default true,
  primary key (branch_id, id)
);

create table edge (
  id            text not null,
  branch_id     text not null references branch(id),
  from_node_id  text not null,
  to_node_id    text not null,
  condition     text,
  primary key (branch_id, id),
  foreign key (branch_id, from_node_id) references node(branch_id, id) on delete cascade,
  foreign key (branch_id, to_node_id)   references node(branch_id, id) on delete cascade
);

create table node_view (
  branch_id text not null references branch(id),
  node_id   text not null,            -- logical id (NOT a FK — view & logic are deliberately decoupled)
  x         double precision not null,
  y         double precision not null,
  width     double precision not null default 160,
  height    double precision not null default 80,
  color     text,
  primary key (branch_id, node_id)
);

-- decision #5: append-only, enforced by the DB itself
create table exec_log (
  id          text primary key,
  flow_id     text not null references flow(id),
  commit_id   text not null references commit(id),  -- which version was live
  node_id     text not null,
  action_type text not null,
  request     jsonb not null,
  response    jsonb not null,
  status      text not null check (status in ('success','failure')),
  created_at  timestamptz not null default now()
);

-- least-privilege app role (the Vercel connection assumes this; granted rds_iam for IAM auth)
create role app_role login;
grant rds_iam to app_role;
grant connect on database postgres to app_role;
grant select, insert, update, delete on flow, branch, commit, node, edge, node_view to app_role;
grant select, insert on exec_log to app_role;                 -- append-only: no update/delete/truncate
revoke update, delete, truncate on exec_log from app_role;

create or replace function block_exec_log_mutation() returns trigger as $$
begin
  raise exception 'exec_log is append-only';
end; $$ language plpgsql;
create trigger exec_log_no_update    before update or delete on exec_log
  for each row       execute function block_exec_log_mutation();
create trigger exec_log_no_truncate  before truncate         on exec_log
  for each statement execute function block_exec_log_mutation();   -- TRUNCATE is a separate trigger event
```

> **Demo proof to keep in your pocket:** connect **as `app_role`** (NOT the RDS master/owner — a superuser bypasses `REVOKE`), then run `UPDATE exec_log SET status='failure' WHERE ...;` or `TRUNCATE exec_log;` live — both raise `exec_log is append-only`. That error *is* the thesis.

---

## 4. The diff engine (the star — field-level)

```
diffGraph(a: GraphDocument, b: GraphDocument) -> GraphDiff
  aN = index a.nodes by id;  bN = index b.nodes by id
  nodes.added    = [ n in b.nodes if n.id not in aN ]
  nodes.removed  = [ n in a.nodes if n.id not in bN ]
  nodes.modified = []
  for id in keys(aN) ∩ keys(bN):
      fc = diffFields(aN[id], bN[id])     # compares type, params.*, credentialRef, isDraftSafe
      if fc not empty: nodes.modified.push({ id, type: bN[id].type, fieldChanges: fc })
  # edges: identical shape, comparing fromNodeId / toNodeId / condition
  # views: NOT diffed (two-layer model)
  return { nodes, edges }

diffFields(x, y) -> FieldChange[]
  paths = union of dotted leaf-paths in x and y   # params.amount, params.currency, credentialRef, ...
  # nested objects flatten to dotted paths; arrays compared as whole values; a type change is a change
  return [ {field: p, before: get(x,p), after: get(y,p)} for p in paths if get(x,p) !== get(y,p) ]
```

- Endpoint `GET /diff?from=&to=` resolves the two commit ids → their `graph_snapshot` JSONB → `diffGraph(snapA, snapB)`.
- **Anchor on stable `id`** → structural, never textual. Reordering nodes is not a change; editing a param is.
- DiffView renders: **added = green, removed = red, modified = amber** with the `before → after` per field. The demo line is `amount: 100 → 90`.

---

## 5. Frontend component tree (React Flow)

```
<CanvasPage>
 ├─ <FlowCanvas>           React Flow; renders GraphDocument; drag/connect; debounced autosave (PUT .../graph)
 │   └─ <BlockNode>        one custom node per NodeType
 ├─ <NodePalette>         drag-to-add the 5 block types            ← v0 scaffold
 ├─ <SidePanel>           selected-node params — ONE generic form rendered from the §2.5 paramSchema map;
 │                          credentialRef picker (hardcoded list, never a raw secret)   ← v0 scaffold
 ├─ <VersionBar>          branch selector · Commit · Branch · history · Rollback ← v0 scaffold
 ├─ <DiffView>            full-panel takeover; field-level highlights (views excluded)
 └─ <ExecLogViewer>       append-only log table + [MOCK] badge on simulated rows — the climax screen ← v0 scaffold
```

- **v0 usage (Vercel sponsor narrative):** scaffold the chrome (palette, side-panel, version bar, log viewer) with v0; **hand-build** `FlowCanvas` and `DiffView` (custom logic, not chrome).
- **SidePanel is one renderer, not five forms:** it reads the §2.5 `paramSchema` for the selected node's type and renders fields generically — adding a node type never touches SidePanel code.

---

## 6. Consequence engine (Lambda) + interpreter + vault

### 6.0 Run path for an irreversible action
1. `POST /run` → safety check: node `isDraftSafe`, **or** branch is `main`/prod. Draft branch + not-draft-safe → **blocked**. *(Demo enforces this as a server-side flag check; the IAM capability — a scoped Lambda role a draft branch cannot assume — is the production design, see §10.)*
2. `MOCK_MODE` set → mock path (§6.2). Else → invoke Lambda with `{execLogId, nodeId, type, params, credentialRef, flowId, commitId}`.
3. Lambda assumes its **scoped IAM role** → fetches the secret named by `credentialRef` from **Secrets Manager** → calls **Stripe in test mode** (card `4242…`, real API call, no money moves).
4. **The Lambda owns its own `exec_log` write** (same AWS-side boundary as the Stripe call). **Climax:** after a real charge, rollback the definition → `/rollback` writes a new commit with the old snapshot → `exec_log` still shows the charge. Definition reverted ≠ consequence reversed.

### 6.1 Interpreter semantics (demo scope — pin this before Day 2)
- **Traversal:** BFS from the start node; outgoing edges followed in insertion order.
- **`condition.if`:** evaluate `params.expression` against the run context; follow the outgoing edge whose `condition` label is the matching `"true"`/`"false"`. *(Demo fixture: a pass-through "always true" is acceptable — the fixture only needs one path.)*
- **Cycles:** a visited-set guard; cycles are not followed.
- **`fromNodeId`:** defaults to the first `trigger.*` node if omitted.
- **Multi-trigger / disconnected nodes:** only the first trigger fires; disconnected nodes are skipped (demo scope).

### 6.2 Mock mode + write integrity
- `MOCK_MODE` is a **Vercel env var** read only by `POST /run`. When set, the handler **skips the Lambda `InvokeCommand`**, returns a synthetic `{ chargeId: "mock_ch_…" }`, and appends `exec_log` with `status:'success'` and `response.mock = true`. `<ExecLogViewer>` shows a **[MOCK]** badge on these rows — never claim a real charge that didn't happen.
- **Real-mode atomicity:** the Lambda sets Stripe's `Idempotency-Key` to `execLogId`, so a retry after a failed log-write is safe and detectable — there is never an un-logged charge (the one failure mode that would falsify the thesis). *(Production would also insert a `pending` row before dispatch; out of demo scope.)*

### 6.3 Vault bootstrap (no CRUD in scope)
Seed one secret by hand, once:
```
aws secretsmanager create-secret --name demo/stripe-test --secret-string '{"key":"sk_test_…"}'
```
`credentialRef` stores the name `demo/stripe-test`; the Lambda's scoped role may read only `demo/*`. The SidePanel picker is a hardcoded `[{id:'demo/stripe-test', label:'Stripe test key'}]`.

---

## 7. Per-rung acceptance criteria (demo scope, rungs 0–5)

| Rung | Definition of Done (testable) | Owner |
|---|---|---|
| **0** Hypothesis | Drop 2 blocks, connect, Save → rows in `node`/`edge`; reload returns the same graph | both |
| **1** It runs | Click Run → interpreter walks from trigger, fires a mock action, result shows; one `exec_log` row | both → **Sync 1** |
| **2** Memory | Save creates a commit; "rollback to last commit" restores prior state; history shows ≥2 commits | both |
| **3** ★ Star | Branch from head → edit a param on the branch → `GET /diff` returns field-level diff → DiffView shows `amount 100→90` → rollback round-trips | both → **Sync 2** |
| **4** Real action | Configure `stripe.charge` (params + `credentialRef`) in SidePanel; Run → Lambda/mock → charge id in `exec_log` | both |
| **5** Honesty | ExecLogViewer shows the append-only log; after a charge, rollback the definition → log still shows the charge; live `UPDATE`/`TRUNCATE exec_log` (as `app_role`) raises the DB exception | both → **Sync 3** |

---

## 8. Reference example flow (build / test fixture)

The canonical flow every rung is built and tested against. The *scripted demo* around it lives in `PRESENTATION.md` — here it is only a fixture.

`trigger.webhook (new subscription)` → `condition.if (plan == "pro")` → `action.stripe.charge (amount: 100 usd)` → `action.slack.post (#revenue)`

- **Diff fixture:** branch from head, edit the charge `amount: 100 → 90` → `GET /diff` must return one `modified` node with `fieldChanges: [{ field: "params.amount", before: 100, after: 90 }]`. Commit this as `fixtures/diff-example.json` on Day 2 so FE builds DiffView against it without waiting for the engine.
- **Immutability fixture:** after a `run`, a live `UPDATE exec_log …` (as `app_role`) must raise `exec_log is append-only`.

---

## 9. 8-Day Countdown (Jun 21 → Jun 29, 17:00 PDT)

| Day | Date | Both / Backend / Frontend | Gate |
|---|---|---|---|
| **0** | Sat Jun 21 | **BOTH:** provision **Aurora Serverless v2 with password auth first** (standalone — layer OIDC/RDS-IAM *after* the DB is reachable; if OIDC > 2h, ship a password `DATABASE_URL` and upgrade later); create **Stripe test account** + grab `sk_test_…` + verify a test charge via curl; scaffold Next.js on Vercel; **freeze §2 Data Contract incl. the §2.5 paramSchema map** | **Sync 0** |
| **1** | Sun Jun 22 | **BE:** full DDL **incl. `app_role` + exec_log immutability** (cheap, do it now) + save/load (rung 0). **FE:** React Flow canvas, drag/connect/save (rung 0) | |
| **2** | Mon Jun 23 | **BE:** interpreter (rung 1, per §6.1) + commit (rung 2, *no rollback yet*); commit `fixtures/diff-example.json`; wire `MOCK_MODE` from here on. **FE:** Run button + version bar + start DiffView against the fixture | **Sync 1** (needs only rung 1) |
| **3** | Tue Jun 24 | ★ **BE:** rollback + branch + field-level diff engine (rung 3). **FE:** wire DiffView to the live engine | |
| **4** | Wed Jun 25 | ★ finish rung 3; **protect this, it's the spine** | **Sync 2** |
| **5** | Thu Jun 26 | **BE:** `stripe.charge` Lambda + Secrets Manager (immutability already shipped Day 1). **FE:** SidePanel (generic form from paramSchema) | |
| **6** | Fri Jun 27 | **BE:** climax wiring + immutability proof (rung 5). **FE:** ExecLogViewer + [MOCK] badge (climax screen) | **Sync 3** |
| **7** | Sat Jun 28 | **FEATURE FREEZE midday.** Both: harden, run the demo in `MOCK_MODE`, **raise Aurora min ACU > 0 for demo**, final integration. *(stretch: hash-chain)* | |
| **8** | Sun Jun 29 (≤17:00 PDT) | Final integration buffer + deploy to production Vercel. **Ship with buffer, not at 16:59.** (submission checklist → `PRESENTATION.md`) | **Ship** |

---

## 10. Cross-cutting pillars (true at every rung)

- **Secrets never in the graph** — `credentialRef` only; raw keys in Secrets Manager/KMS; enforced by the per-type zod allowlist (§2.5) at the API boundary so a token can't be smuggled into `params`. Keeps secrets out of snapshots, diffs, and the log.
- **Draft/prod isolation** — the demo enforces `isDraftSafe` server-side (a flag check); the **production** design is capability-based: a scoped Lambda role a draft branch cannot assume, with Secrets Manager namespaced `draft/*` vs `prod/*`. Say it honestly — flag now, IAM capability next.
- **Definition rollback ≠ consequence rollback** — the DB-immutable `exec_log` is the architectural proof and the demo's honesty.
- **Structural, not textual** — diff and rollback operate on stable node IDs, never raw text. *(There is no multi-branch merge feature — the two-layer split is a separation, not a merge algorithm.)*
- **The deployment split itself** — Vercel (canvas + version-control API + interpreter) ↔ AWS (Aurora + Lambda + vault) is the exact Vercel↔AWS-Databases integration the hackathon showcases.

## 11. Deliberately deferred (maturity, not gaps)

Real-time multiplayer & multi-branch merge, marketplace, import-from-Zapier, mobile, AI flow-generation, sub-flows/loops, full multi-tenant SaaS + SOC 2, RBAC (rung 8), durable execution/Temporal (rung 9), real triggers (rung 7), exec-log hash-chain. Boundaries are respected now; implementation is post-MVP-10. AI is one *action type*, never the foundation.

---

## 12. Related documents

- **`PRESENTATION.md`** — demo script, submission deliverables, and the pitch playbook for the DB-expert panel. *(All pitch/logistics live there; this spec stays software-only.)*
- **`roadmap-spec-ready.md`** — the roadmap this spec implements.
- **`h0-hackathon-research.md`**, **`h0-judges.md`** — the fact base.
