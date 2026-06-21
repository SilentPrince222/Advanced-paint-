# Visual Automation Builder — Roadmap (Spec-Ready)

*A self-contained roadmap with enough embedded context to grow directly into a technical spec. Audience: the two builders (backend/hardening owner + frontend/canvas owner). Not a pitch document.*

---

## 0. Orientation — Read This First

**What we are building.** A B2B automation platform where users *draw* a process on an infinite canvas, wire its logic from snap-together blocks (Scratch-style) instead of code, and get **Git-style version control over that automation graph** — branch, structural diff, rollback. The third capability is the differentiator; nobody (Zapier, Make, n8n) versions flows this way.

**The one-line moat.** Automations today are un-versioned "set it and pray" scripts. We make them branchable, diffable, reviewable infrastructure — the way real software is already built.

**The star feature (what the demo is built around).** `branch → edit a flow → structural diff → rollback`. Everything else is foundation that exists to make the star credible.

**Hackathon frame (H0: Hack the Zero Stack with Vercel v0 and AWS Databases — first edition).** *All facts verified in `h0-hackathon-research.md`; submission deadline **June 29, 2026, 17:00 PDT**.*
- **Track: B2B (Track 2)** — monetizable business app (finance / technology / healthcare / insurance / marketing). Our billing-flow case fits finance + technology.
- **Stack gates:** use **one of three AWS databases** as the primary backend — **Aurora PostgreSQL / Aurora DSQL / DynamoDB** — and deploy the frontend on **Vercel** (v0 recommended but optional). *Aurora PostgreSQL is **not** mandated; we pick it deliberately on the merits — that choice is itself the argument (see §2.3), not a checkbox.*
- **Required deliverables:** demo video **< 3 min**, architecture diagram, link to the published Vercel project, screenshot proving AWS-DB usage, Vercel Team ID.
- **Judging:** a pass/fail viability gate, then **four equally-weighted criteria** — Technical Implementation, Design, Impact & Real-World Applicability, Originality — final score 1.0–5.6. Build-in-public content tagged **#H0Hackathon is a *bonus* (up to +0.6, ~11%), not a requirement.**
- **Who judges (decisive):** ~10 AWS people, **database-heavy** (Joseph Idziorek — Director of PM, AWS Databases; Tim Stoakes — Sr. Principal Technologist; full panel + per-judge intel in `h0-hackathon-research.md`). No confirmed Vercel judge → they will scrutinize the **data model** with expert eyes.
- **Where we score:** the Aurora hybrid data model → **Technical Implementation** (the criterion this DB-expert panel rewards most). Git-versioning of flows → **Originality** (the star). "Definition rollback ≠ consequence rollback" → **Impact & Real-World Applicability**. A project wins **only one** prize — we aim at **Track 2 placement** carried by Originality + Technical Implementation.

**The chosen demo case: Billing / revenue flow (Stripe).**
A finance/ops team owns a revenue-critical billing flow. They need to change it (e.g., a discount condition) without risking real money. They branch, edit, diff, test, publish — and if it breaks, roll back.

**The deliberate risk we showcase (not hide).** Stripe runs in **test mode** (real API calls, test keys, card `4242…`, no money moves) — so the integration is genuinely shippable. In the live demo, execution is served from a **mocked/recorded response** as a stability safeguard. The climax is the honest point: *rolling back the flow definition is instant, but the charge that already fired is NOT undone.* The immutable execution log shows this on purpose. This proves the core thesis — **reverting a definition ≠ reversing a real-world consequence** — and turns payment irreversibility from a perceived flaw into the headline argument.

---

## 1. Team Split & The Contract Between Us

**Two builders, two tracks, one shared spine.**

- **Backend / hardening owner** (experienced, PlotCod Max 20): Aurora schema, graph execution engine, versioning/diff/rollback, security (vault, draft/prod isolation, audit log). The *engine and the safe*.
- **Frontend / canvas owner** (idea author): React Flow canvas, drawing, connecting blocks, side-panel, version/diff visualization. The *face of the product*.
- **The shared spine (neither edits alone): the Data Contract** — the JSON graph schema + the API shape between front and back. This is the wall that lets the two tracks proceed independently without colliding.

**Sequencing rule (critical).** Do **not** split first. Phase A = both builders lock the Data Contract together (one evening). Only then, Phase B = split by track and work independently behind the contract. Building two bridges from opposite banks without an agreed meeting point in the middle is the one failure mode that wastes days.

---

## 2. The Data Contract (Spine — Build This First, Together)

This section is the seed of the spec. Everything downstream depends on these shapes being fixed.

### 2.1 Graph document — two layers, linked by node ID
The whole point of the split is that *moving a block on the canvas* and *changing its logic* are independent classes of change that never collide in a merge.

**Logic layer** (what runs — owned conceptually by backend):
```
node:  { id, type, params, credentialRef?, isDraftSafe }
edge:  { id, fromNodeId, toNodeId, condition? }
```
- `type` — e.g. `trigger.schedule`, `trigger.webhook`, `action.stripe.charge`, `action.slack.post`, `condition.if`.
- `params` — per-type config (e.g. amount, message template).
- `credentialRef` — **opaque ID into the vault, never a raw secret.** This field existing from day one is what keeps keys out of version history.
- `isDraftSafe` — marks whether this node may execute in a draft/branch context (a Stripe charge is not draft-safe).

**Presentation layer** (where it sits — owned conceptually by frontend):
```
view:  { nodeId, x, y, width, height, color }
```
Keyed by the same `nodeId`. Position changes auto-merge and never conflict.

**Version envelope** (the spine of the star):
```
commit: { id(hash), parentId, branchId, authorNote, timestamp, graphSnapshotRef }
branch: { id, name, headCommitId, baseCommitId }
```

### 2.2 API shape (front ↔ back)
Minimum surface to fix now (details later in spec):
- `POST /flows` / `GET /flows/:id` — load/save a graph document.
- `POST /flows/:id/commit` — snapshot current state → returns commit.
- `POST /flows/:id/branch` — fork → returns branch.
- `GET /flows/:id/diff?from=&to=` — structural diff between two commits.
- `POST /flows/:id/rollback` — set head to a prior commit.
- `POST /flows/:id/run` — execute (real in prod, mocked in demo).

### 2.3 Aurora PostgreSQL storage model
Hybrid, and this hybrid *is* the "deliberate data model" — the single highest-leverage thing in front of a panel of AWS **database** leaders (see §0 judges):
- **JSONB** column holds the full graph snapshot → fast whole-flow load (index with GIN where we query into it).
- **Normalized `node` / `edge` tables** → efficient querying, structural diffing, referential integrity.
- **Chosen on purpose over the other two eligible H0 databases.** Aurora DSQL (distributed SQL, reduced feature surface) and DynamoDB (key-value, no relational joins) both fight graph + version semantics, which need relational joins *and* JSONB together. Naming this trade-off out loud is the argument that wins Technical Implementation — not a checkbox.
- **Connect via the native Vercel ↔ Aurora PostgreSQL Marketplace integration** (OIDC Federation + RDS IAM auth). It removes the serverless→DB connection/credential pain and *is itself* the Vercel↔AWS-Databases integration the hackathon showcases. Run on **Aurora Serverless v2** for scale-to-zero + instant provisioning in the demo.

---

## 3. The MVP Ladder (Vertical Slices)

Each rung is a **self-contained, demonstrable product** — you can stop at any rung and show something that works. MVP 0 = hypothesis proof; **MVP 10 = a healthy, finished product (runs like clockwork, every feature considered)**; beyond = the SaaS horizon. Each rung touches all layers (a slice of front + back + DB), which is why the contract must exist first.

| Rung | Name | What works end-to-end | Backend owner | Frontend owner |
|------|------|----------------------|---------------|----------------|
| **0** | Hypothesis | Drop 2 blocks, connect, Save → JSON graph persists in Aurora | Schema + save/load API | Canvas, drag, connect, Save button |
| **1** | It runs | 1 trigger + 1 action fire (mock action / log) | Interpreter walks the graph | "Run" button + result display |
| **2** | Memory | Save creates a commit; "roll back to last save" works | Commit + rollback | Version indicator + rollback button |
| **3** | ★ The Star | Branch → edit → structural diff → rollback, visualized | Branch + structural diff engine | Side-by-side graph diff UI |
| **4** | Real action | Stripe (test mode) charge + Slack post via real API | Action handlers + vault for creds | Side-panel to configure block params |
| **5** | Honesty | Immutable execution log; rollback proves "definition ≠ consequence" | Append-only exec log, separate from versions | Log viewer; the demo climax screen |
| **6** | Safety | Draft/prod isolation: branches physically can't touch live creds | Scoped IAM roles, `isDraftSafe` enforcement | Draft/prod badge; blocked-action UX |
| **7** | Live | Real triggers: webhook receiver + cron scheduler | Trigger service (only main branch registers live) | Trigger config UI |
| **8** | Trust | RBAC (view/edit/publish/reveal-creds) | Permission layer | Role-aware UI states |
| **9** | Reliability | Durable execution (retries, partial failure) via Temporal | Temporal integration | Run-status / retry surfacing |
| **10** | Finished | Hardening, UX polish, edge cases — "runs like clockwork" | Bug hunt, harden, isolate | Polish, empty states, errors |

**Demo cut line.** The submission demo must show **rung 3 (the star) + rung 5 (the honesty climax)** working on the real stack. Rungs 4–6 make the Billing case land. Everything above is the believable "and here's where it goes" vision.

---

## 4. Synchronization Points

The two tracks run independently *between* these checkpoints and must reconverge *at* them. After each, the halves assemble into one working product before anyone moves on.

- **Sync 0 — Contract frozen.** §2 agreed and committed. Gate before any split work.
- **Sync 1 — "Draw it → it runs" (after rung 1).** Frontend's saved JSON actually executes on backend's interpreter. First proof the bridge meets in the middle.
- **Sync 2 — Star works (after rung 3).** Branch/diff/rollback round-trips through both halves. This is the demo's spine; protect the schedule to reach it.
- **Sync 3 — Billing case lands (after rung 5).** Real Stripe(test)+Slack execution + immutable log + the rollback-honesty climax demonstrable end-to-end.
- **Sync 4 — Product feel (after rung 10).** Hardening + polish merged; one coherent thing that runs like clockwork.

---

## 5. Cross-Cutting Pillars (True at Every Rung)

These are not steps — they are properties every rung must respect, designed in from the first commit.

- **Secrets never in the graph.** `credentialRef` only; raw keys live in AWS Secrets Manager / KMS. Keeps secrets out of version history and diffs.
- **Draft/prod isolation by capability, not convention.** Scoped IAM roles; `isDraftSafe` enforced server-side; a branch cannot reach a live credential even in principle.
- **Definition rollback never implies consequence rollback.** The immutable execution log is the architectural proof; it is the demo's honesty and the thesis of the project.
- **Deployment split:** Vercel (canvas via v0 + light serverless CRUD) ↔ AWS (Aurora, execution, triggers, vault). The exact Vercel↔AWS-Databases integration the hackathon showcases.
- **Structural, not textual, everything.** Diff, merge, conflict resolution all operate on graph semantics (stable node IDs), never raw text.

---

## 6. What This Roadmap Deliberately Defers

Stated so they are recognized as *chosen* deferrals (a sign of maturity), not gaps:
- Real-time multiplayer editing, marketplace, import-from-Zapier, mobile app, AI flow-generation, sub-flows, loops — all post-MVP-10 horizon.
- Full multi-tenant SaaS isolation and SOC 2 — designed-toward (boundaries respected now), implemented later.
- AI is one *action type*, not the foundation; natural-language flow-building is a later layer, not a rung on the critical path.

---

## 7. Immediate Next Actions

0. **Both, TODAY — time-critical:** register at `h01.devpost.com` and request the **$100 AWS + $30 v0 credits** — the credit window closes **~June 26**, *before* the build deadline. Provision Aurora via the **native Vercel ↔ Aurora PostgreSQL Marketplace integration** (OIDC + RDS IAM) so serverless→DB auth is solved from day one. Plan the schedule against the **June 29, 17:00 PDT** deadline (~8 days).
1. **Both:** freeze §2 Data Contract (Sync 0). Nothing else starts before this.
2. **Backend owner:** stand up Aurora, implement schema + save/load (rung 0 backend), then interpreter (rung 1).
3. **Frontend owner:** scaffold React Flow canvas via v0, drag/connect/save (rung 0 frontend).
4. **Both:** meet at Sync 1 — prove "draw it → it runs."
5. Then march the ladder toward the demo cut line (rungs 3 + 5), defending the schedule to reach the star.
