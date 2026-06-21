# Visual Automation Builder — Build Spec (H0)

*The execute-from document for two builders. Turns `roadmap-spec-ready.md` into concrete schema, contracts, algorithms, components, acceptance criteria, and an 8-day plan. Grounded in `h0-hackathon-research.md` + `h0-judges.md`.*

> **Deadline:** June 29, 2026, 17:00 PDT (drives the §9 build schedule). **Demo cut line: rungs 3 + 5 working on the real stack.**

---

## 0. Decisions Locked (read first)

| # | Decision | Choice | Why (one line) |
|---|----------|--------|----------------|
| 1 | **Backend architecture** | **balanced-A** — TS everywhere; Next.js on Vercel ↔ Aurora direct; **one AWS Lambda** = "consequence engine" for irreversible actions | Both sponsors used heavily where it *scores*; fewest moving parts for 8 days; the Lambda makes the honesty thesis architecturally literal |
| 2 | **Version storage** | **Snapshot per commit** — each commit stores the full graph as JSONB ("photos") | Simple, instant read, unbreakable on a deadline; storage is free at our scale |
| 3 | **Diff depth** | **Field-level** — node/edge add/remove/modify **+ per-param `before → after`** | The money shot of the demo is the app pointing at `amount: 100 → 90` |
| 4 | **Auth / tenancy** | **None** — single hardcoded demo workspace, no `user`/`org` columns | Judges score versioning magic, not a login screen |
| 5 | **Exec-log immutability** | **DB-level** — `REVOKE UPDATE/DELETE` + a trigger that blocks mutation. *(hash-chain = optional stretch)* | For a DB-expert panel, "the database forbids it, not us" is the strong answer |

**Non-negotiables:** reach rung 3 (the star) and rung 5 (the honesty climax) on the real stack. Everything above rung 5 is the believable "and here's where it goes."

---

## 1. Architecture (balanced-A)

```
 VERCEL  (Next.js App Router)                       AWS
 ┌─────────────────────────────┐         ┌────────────────────────────────────┐
 │ /app        canvas (React    │         │ Aurora PostgreSQL (Serverless v2)  │
 │             Flow) + UI       │  OIDC + │   • commits.graph_snapshot (JSONB) │
 │ /app/api/*  Route Handlers   │◄──IAM──►│   • node/edge/node_view (live copy)│
 │             = the version-    │  (Mktpl │   • exec_log (append-only, DB-      │
 │             control API      │  integ.)│      enforced immutable)           │
 │                              │         │                                    │
 │  run (irreversible action) ──┼────────►│ Lambda "consequence engine"        │
 │                              │         │   reads cred ► Secrets Manager/KMS │
 │                              │         │   calls Stripe (test) ► writes log │
 └─────────────────────────────┘         │ IAM: scoped role (draft can't reach│
                                          │      a live credential)            │
                                          └────────────────────────────────────┘
```

- **Vercel** = the version-control surface: canvas, branch/diff/rollback, CRUD API (Route Handlers talk to Aurora directly via the native Vercel↔Aurora Marketplace integration — OIDC Federation + RDS IAM auth, no password in env).
- **AWS** = the system of record (graph + versions + immutable log) **and the place where irreversible consequences happen** (the Lambda).
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
  params: Record<string, unknown>;  // per-type config, validated by a per-type zod schema
  credentialRef?: string;           // opaque vault id — NEVER a raw secret
  isDraftSafe: boolean;             // false for action.stripe.charge
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  condition?: string;               // optional guard expression
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
Two layers keyed by the same `id` is the whole reason the split works: moving a block (a `view` change) and editing its logic (a `node` change) are different classes of change that can never collide. The diff engine deliberately **ignores `views`** — so "I dragged the box" never shows up as "the flow changed."
`─────────────────────────────────────────────────`

### 2.2 Version envelope

```ts
export interface Commit {
  id: string;                       // hash id
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
  id: string;
  flowId: string;
  commitId: string;                 // which version was live when this ran
  nodeId: string;
  actionType: NodeType;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  status: "success" | "failure";
  createdAt: string;
  prevHash?: string;                // optional stretch (hash-chain)
  rowHash?: string;
}
```

### 2.4 API surface (Next.js Route Handlers)

| Method & path | Body | Returns | Behavior |
|---|---|---|---|
| `POST /api/flows` | `{name}` | `{flow, branch}` | Create flow + `main` branch + empty initial commit |
| `GET /api/flows/:id` | — | `{flow, branches, head: GraphDocument}` | Load flow + live head graph |
| `PUT /api/flows/:id/branches/:bid/graph` | `GraphDocument` | `{ok}` | Autosave: upsert live `node`/`edge`/`node_view` for the branch |
| `POST /api/flows/:id/branches/:bid/commit` | `{authorNote}` | `Commit` | Serialize live graph → new commit row w/ snapshot; advance `head_commit_id` |
| `POST /api/flows/:id/branches` | `{fromCommitId, name}` | `Branch` | Fork: copy that commit's snapshot into a new branch's live tables; set `base`/`head` |
| `GET /api/flows/:id/diff?from=&to=` | — | `GraphDiff` | Field-level diff between two commit snapshots |
| `POST /api/flows/:id/branches/:bid/rollback` | `{toCommitId}` | `Commit` | Load that snapshot into live tables **and write a new commit** recording the rollback |
| `POST /api/flows/:id/branches/:bid/run` | `{fromNodeId?}` | `{entries: ExecLogEntry[]}` | Execute; real (invoke Lambda) or mock; **always** appends to `exec_log` |
| `GET /api/flows/:id/execlog` | — | `ExecLogEntry[]` | Append-only log (the climax screen). Read-only. |

> **Rollback is itself a commit.** History never loses the fact that you rolled back — honest, and it reads well to the panel.

---

## 3. Aurora PostgreSQL schema (DDL)

Hybrid by design — **JSONB snapshots for immutable history** (fast whole-flow load) **+ normalized live tables for the editable head** (FK integrity, joins, structural diff). This duality is the answer to "why not DynamoDB / why not DSQL."

```sql
-- decision #4: single demo workspace — NO users/orgs.

create table flow (
  id                text primary key,
  name              text not null,
  default_branch_id text,
  created_at        timestamptz not null default now()
);

create table branch (
  id             text primary key,
  flow_id        text not null references flow(id),
  name           text not null,
  head_commit_id text,        -- soft pointer (avoids circular FK with commit)
  base_commit_id text
);

create table commit (
  id             text primary key,                 -- hash
  flow_id        text not null references flow(id),
  branch_id      text not null references branch(id),
  parent_id      text references commit(id),       -- DAG
  author_note    text not null default '',
  created_at     timestamptz not null default now(),
  graph_snapshot jsonb not null                    -- FULL snapshot ("photos")
);
create index commit_snapshot_gin on commit using gin (graph_snapshot);  -- query into snapshots
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
  node_id   text not null,
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
  created_at  timestamptz not null default now(),
  prev_hash   text,                                  -- optional stretch (hash-chain)
  row_hash    text
);

revoke update, delete on exec_log from app_role;     -- app can only INSERT + SELECT
create or replace function block_exec_log_mutation() returns trigger as $$
begin
  raise exception 'exec_log is append-only';
end; $$ language plpgsql;
create trigger exec_log_no_update before update or delete on exec_log
  for each row execute function block_exec_log_mutation();
```

> **Demo proof to keep in your pocket:** in `psql`, run `UPDATE exec_log SET status='failure' WHERE ...;` live — it raises `exec_log is append-only`. That one error message *is* the thesis.

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
  paths = union of dotted paths in x and y   # params.amount, params.currency, credentialRef, ...
  return [ {field: p, before: get(x,p), after: get(y,p)} for p in paths if get(x,p) !== get(y,p) ]
```

- **Anchor on stable `id`** → structural, never textual. Reordering nodes is not a change; editing a param is.
- DiffView renders: **added = green, removed = red, modified = amber** with the `before → after` per field. The demo line is `amount: 100 → 90`.

---

## 5. Frontend component tree (React Flow)

```
<CanvasPage>
 ├─ <FlowCanvas>           React Flow; renders GraphDocument; drag/connect; debounced autosave (PUT .../graph)
 │   └─ <BlockNode>        one custom node per NodeType
 ├─ <NodePalette>         drag-to-add the 5 block types            ← v0 scaffold
 ├─ <SidePanel>           selected-node param config; credentialRef picker (never raw secret) ← v0 scaffold
 ├─ <VersionBar>          branch selector · Commit · Branch · history · Rollback ← v0 scaffold
 ├─ <DiffView>            side-by-side two snapshots; field-level highlights (views excluded)
 └─ <ExecLogViewer>       append-only log table — the demo climax screen ← v0 scaffold
```

- **v0 usage (Vercel sponsor narrative):** scaffold the chrome (palette, side-panel, version bar, log viewer) with v0; **hand-build** `FlowCanvas` and `DiffView` (custom logic, not chrome).

---

## 6. Consequence engine (Lambda) + vault

Run path for an irreversible action:

1. `POST /run` → handler checks safety: node `isDraftSafe`, **or** branch is `main`/prod. Draft branch + not-draft-safe → **blocked** (rung 6 enforcement; in demo scope, at minimum honor the flag).
2. **Demo mode** (`MODE=mock`) → return a canned Stripe response, **still append to `exec_log`** (status `success`). Stability safeguard for the live demo.
3. **Real mode** → invoke Lambda with `{nodeId, type, params, credentialRef, flowId, commitId}`.
4. Lambda assumes its **scoped IAM role** → fetches the secret named by `credentialRef` from **Secrets Manager** → calls **Stripe in test mode** (card `4242…`, real API call, no money moves).
5. Append the result to `exec_log` (append-only).
6. **Climax:** after a real charge, user rolls back the definition → `/rollback` writes a new commit with the old snapshot → **`exec_log` still shows the charge.** Definition reverted ≠ consequence reversed.

---

## 7. Per-rung acceptance criteria (demo scope, rungs 0–5)

| Rung | Definition of Done (testable) | Owner |
|---|---|---|
| **0** Hypothesis | Drop 2 blocks, connect, Save → rows in `node`/`edge`; reload returns the same graph | both |
| **1** It runs | Click Run → interpreter walks from trigger, fires a mock action, result shows; one `exec_log` row | both → **Sync 1** |
| **2** Memory | Save creates a commit; "rollback to last commit" restores prior state; history shows ≥2 commits | both |
| **3** ★ Star | Branch from head → edit a param on the branch → `GET /diff` returns field-level diff → DiffView shows `amount 100→90` → rollback round-trips | both → **Sync 2** |
| **4** Real action | Configure `stripe.charge` (params + `credentialRef`) in SidePanel; Run → Lambda/mock → real test charge id in `exec_log` | both |
| **5** Honesty | ExecLogViewer shows the append-only log; after a charge, rollback the definition → log still shows the charge; live `UPDATE exec_log` raises the DB exception | both → **Sync 3** |

---

## 8. Reference example flow (build / test fixture)

The canonical flow every rung is built and tested against. The *scripted demo* around it lives in `PRESENTATION.md` — here it is only a fixture.

`trigger.webhook (new subscription)` → `condition.if (plan == "pro")` → `action.stripe.charge (amount: 100 usd)` → `action.slack.post (#revenue)`

- **Diff fixture:** branch from head, edit the charge `amount: 100 → 90` → `GET /diff` must return one `modified` node with `fieldChanges: [{ field: "params.amount", before: 100, after: 90 }]`.
- **Immutability fixture:** after a `run`, a live `UPDATE exec_log …` must raise `exec_log is append-only`.

---

## 9. 8-Day Countdown (Jun 21 → Jun 29, 17:00 PDT)

| Day | Date | Both / Backend / Frontend | Gate |
|---|---|---|---|
| **0** | Sat Jun 21 | **BOTH:** provision **Aurora Serverless v2** via the Vercel↔Aurora integration; scaffold Next.js on Vercel; **freeze §2 Data Contract** | **Sync 0** |
| **1** | Sun Jun 22 | **BE:** DDL + save/load (rung 0). **FE:** React Flow canvas, drag/connect/save (rung 0) | |
| **2** | Mon Jun 23 | **BE:** interpreter (rung 1) + commit/rollback (rung 2). **FE:** Run button + version bar | **Sync 1** |
| **3** | Tue Jun 24 | ★ **BE:** branch + field-level diff engine (rung 3). **FE:** DiffView side-by-side | |
| **4** | Wed Jun 25 | ★ finish rung 3; buffer to polish the diff — **protect this, it's the spine** | **Sync 2** |
| **5** | Thu Jun 26 | **BE:** stripe.charge Lambda + Secrets Manager + `exec_log` immutability (rung 4). **FE:** SidePanel param config | |
| **6** | Fri Jun 27 | **BE:** climax wiring + immutability proof (rung 5). **FE:** ExecLogViewer (climax screen) | **Sync 3** |
| **7** | Sat Jun 28 | **FEATURE FREEZE midday.** Both: harden, enable `MODE=mock` for demo stability, final integration. *(stretch: hash-chain)* | |
| **8** | Sun Jun 29 (≤17:00 PDT) | Final integration buffer + deploy to production Vercel. **Ship with buffer, not at 16:59.** (submission checklist → `PRESENTATION.md`) | **Ship** |

---

## 10. Cross-cutting pillars (true at every rung)

- **Secrets never in the graph** — `credentialRef` only; raw keys in Secrets Manager/KMS. Keeps secrets out of snapshots, diffs, and history.
- **Draft/prod isolation by capability** — scoped IAM on the Lambda; `isDraftSafe` enforced server-side; a draft branch cannot reach a live credential even in principle.
- **Definition rollback ≠ consequence rollback** — the DB-immutable `exec_log` is the architectural proof and the demo's honesty.
- **Structural, not textual** — diff/merge/rollback operate on stable node IDs, never raw text.
- **The deployment split itself** — Vercel (canvas + version-control API) ↔ AWS (Aurora + Lambda + vault) is the exact Vercel↔AWS-Databases integration the hackathon showcases.

## 11. Deliberately deferred (maturity, not gaps)

Real-time multiplayer, marketplace, import-from-Zapier, mobile, AI flow-generation, sub-flows/loops, full multi-tenant SaaS + SOC 2, RBAC (rung 8), durable execution/Temporal (rung 9), real triggers (rung 7). Boundaries are respected now; implementation is post-MVP-10. AI is one *action type*, never the foundation.

---

## 12. Related documents

- **`PRESENTATION.md`** — demo script, submission deliverables, and the pitch playbook for the DB-expert panel. *(All pitch/logistics live there; this spec stays software-only.)*
- **`roadmap-spec-ready.md`** — the roadmap this spec implements.
- **`h0-hackathon-research.md`**, **`h0-judges.md`** — the fact base.
