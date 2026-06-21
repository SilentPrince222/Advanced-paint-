# H0 Hackathon — Judging Panel & Pitch Strategy

*Companion to `roadmap-spec-ready.md` and `h0-hackathon-research.md`. Compiled 2026-06-21 from two research agents (roster + deep-dive/strategy). Source: the Devpost judges section (https://h01.devpost.com/) plus per-judge LinkedIn / AWS Database Blog / re:Invent verification. Read §0 first — it's the part that changes how we present.*

---

## 0. The 5 things to internalize before we pitch

1. **The panel is 10 AWS people, zero confirmed Vercel.** This is a **database** jury. The data model is the game; the v0 UI is necessary but not where these judges live.
2. **It skews to people who own/scale specific engines:** DynamoDB/NoSQL (Idziorek, Vijayraghavan), Aurora (Stoakes, Samant, Bhatia), ElastiCache/Valkey (Castro), Redshift/analytics (Gibbs), GenAI+RAG (Yadav), prescriptive DB best-practice (Balasubramanian), AI-on-DB marketing (Anand). **Common reward across all: the AWS data layer as a first-class, well-architected, scalable component — not a thin CRUD store behind a pretty UI.**
3. **⚠️ Correction that prevents a faceplant:** **Joseph Idziorek's public voice is DynamoDB / NoSQL / zero-ETL / "model to access patterns."** He is *now* a PM on **Aurora DSQL** but has **no public DSQL quotes** — treat him as "NoSQL-and-scale, now DSQL-curious," NOT a relational purist. **Tim Stoakes is Aurora *storage / durability / distributed systems*** — pitching him single-table NoSQL design would backfire.
4. **They live in trade-off space.** A *defended* choice ("we considered DSQL and DynamoDB, chose Aurora PostgreSQL because…") reads senior. A default choice ("Postgres because we know it") reads junior and is the fastest way to lose them.
5. **Our biggest exposure: the dual-write.** Our hybrid writes JSONB *and* normalized tables. If we say "we keep them in sync" without "**in one transaction**," Stoakes — who built Aurora's storage layer — spots the integrity hole instantly. Pre-empt it every time.

> **Theme heavy in this panel: AI-on-databases / agentic AI** (Stoakes, Castro, Yadav, Anand all work here now). Optional bonus hook: our versioned graph store is a natural substrate for an *agent that safely modifies automations* — branch, let the agent edit, diff, human-approve, rollback. Mention only if it lands naturally; don't bolt AI onto the core thesis.

---

## 1. Full Roster (10 judges, all AWS)

**Vercel check:** none of the listed judges are from Vercel. The Vercel/v0 side is represented only via the AWS-authored launch blog co-written by judge **Abhinav Anand**.

| Judge | Title | Owns / champions | Likely rewards |
|-------|-------|------------------|----------------|
| **Joseph Idziorek** | Director, PM, AWS Databases (nonrelational; now PMT on Aurora DSQL) | DynamoDB, zero-ETL, serverless/on-demand economics, access-pattern modeling | Right purpose-built DB for the workload; access-pattern-driven design; single-request hot reads |
| **Tim Stoakes** | Sr. Principal Technologist, AWS | Aurora storage internals, durability, HA/DR, distributed systems; data-for-agentic-AI | DB as a serious well-architected foundation; consistency, failure modes, perf+cost |
| **Karthik Vijayraghavan** | Sr Manager, NoSQL Solutions Architects | DynamoDB/DocumentDB migration & single-table design | Intentional NoSQL: clean access patterns, scale/cost-efficiency, migration story |
| **Aditya Samant** | Principal DB Specialist SA, Aurora | Aurora Global Database, multi-Region resilience | AWS-native relational done right: scalability, resilience, real schema design |
| **David Castro** | Principal PM, AWS Databases | ElastiCache Serverless / Valkey, agentic memory, vector search | Smart in-memory/cache layer; sub-ms latency; semantic caching; not plain CRUD |
| **Tony Gibbs** | Sr Manager, Specialist SAs | Redshift/analytics, Timestream, RDS | Depth on an AWS data service; sound schema/query/cost choices; rigor over UI polish |
| **Rohan Bhatia** | Principal PM, AWS Databases | Aurora PostgreSQL, Aurora Global Database | Aurora as a real backend; cross-Region scale, resilience, clean v0→durable-DB path |
| **Ravi Yadav** | Principal Specialist, Data & AI | Bedrock, RAG, agentic AI on EKS, multi-tenant SaaS | Multi-tenant production GenAI on an AWS data layer; clean tenant isolation |
| **Gowri Balasubramanian** | Sr Manager, Solutions Architecture | Relational+NoSQL best practices (Aurora/RDS/DynamoDB), partition-key design | Prescriptive correct choices: right engine, well-designed schema/keys, production concerns |
| **Abhinav Anand** | Technical Product Marketing, AWS Databases | AI-native full-stack; Aurora DSQL / PG (pgvector) / DynamoDB; RAG, GraphRAG | Crisp "AI-native full-stack on Vercel+AWS DB" story; scale-to-zero, designed-for-scale |

**Don't trust the rumors:** AI-generated search summaries claimed Vijayraghavan (left Apr 2025), Bhatia (→ Stripe/retired), and Yadav (→ Couchbase) had departed AWS. All three are **unsupported and contradicted** by the current Devpost listing — treat as false.

**Could-not-verify (minor):** Tony Gibbs — no dated 2024–26 talk with a stable URL (only ongoing LinkedIn + 2019–21 Redshift sessions); Abhinav Anand — exact LinkedIn URL not pinned (identity firmly confirmed via AWS blog byline); Ravi Yadav — exact title string from Devpost, not a scraped LinkedIn headline (AWS + Data/AI focus corroborated).

---

## 2. Deep-Dive: The Two Anchors

### Joseph Idziorek — Director of PM, AWS Databases (now PMT on Aurora DSQL)
What he champions, in his own words:
- **Consistent single-digit-ms performance at any scale** — *"We built DynamoDB to provide customers like Zoom with consistent, single-digit millisecond performance at any scale."* ([ODBMS Q&A](https://www.odbms.org/2022/09/on-high-performance-applications-at-scale-and-amazon-dynamodb-qa-with-joseph-idziorek/))
- **Work backwards from customers** — *"DynamoDB was built by working backwards from customers… to provide a fully-managed database service."* (same)
- **Model data to access patterns; unbounded JOINs degrade at scale** — *"DynamoDB does not expose the concept of JOINs. As data sizes grow, the performance of using JOINs degrades… customers optimize their data model such that queries can be answered by a single request to the database to a primary key."* (same) — *Nuance: it's a NoSQL argument; he respects deliberate access-pattern modeling and doesn't call JOINs inherently bad — only unbounded JOINs at massive scale.*
- **Zero-ETL = removing "undifferentiated heavy lifting"** ([LinkedIn](https://www.linkedin.com/posts/josephidziorek_aws-dynamodb-redshift-activity-7252315059165503488-F5U8))
- **Serverless/on-demand by default; cost + operational simplicity** ([DynamoDB pricing blog](https://aws.amazon.com/blogs/database/new-amazon-dynamodb-lowers-pricing-for-on-demand-throughput-and-global-tables/))
- Stage: re:Invent 2024 **DAT419** "An insider's look into architecture choices for Amazon DynamoDB." Academic: co-author of the DynamoDB USENIX ATC 2022 + OSDI 2023 papers ([Amazon Science](https://www.amazon.science/author/joseph-idziorek)).
- **Because he's now on the DSQL team**, a credible "we considered DSQL and here's why we didn't pick it" earns respect — but only if the reason is real.

### Tim Stoakes — Sr. Principal Technologist, AWS (Aurora Storage, Adelaide)
- **Aurora: performance, availability, cost-effectiveness, full MySQL/PG compatibility, serverless** — "Deep Dive Into Amazon Aurora and Its Innovations," AWS Data & AI Roadshow 2025.
- **Storage internals + durability** — *"Want to work at the intersection of massive databases and epic storage?"* ([LinkedIn](https://www.linkedin.com/posts/tim-stoakes_principal-software-engineer-aurora-storage-activity-7204384106179211264-JFw_))
- **Performance AND cost together** — re:Invent 2024 **DAT315** "Boost performance and reduce costs in Amazon Aurora and Amazon RDS" ([YouTube](https://www.youtube.com/watch?v=YGFWbS9ZJZk)).
- **Resiliency / surviving failure** — re:Invent 2023 with Grant McAlister on DB-tier resiliency + multi-region partitioning.
- **Current frontier: data for agentic AI** — re:Invent 2025 "A practitioner's guide to data for agentic AI" (Aurora + OpenSearch + Bedrock) ([YouTube](https://www.youtube.com/watch?v=XLWjq5FInyQ)).
- *Could not find: a first-person data-modeling-philosophy quote, a podcast, or an AWS blog byline. Don't put standard "6 copies / 3 AZs / 4-of-6 quorum" Aurora messaging in his mouth as a personal quote.*

---

## 3. What This Panel Rewards / Punishes

**Rewards:**
- **A data model justified by access patterns, not taste** (Idziorek's whole career). Name the hot query (graph load) and the integrity-critical one (structural diff); let the model fall out.
- **An explicit, defended trade-off** ("considered X/Y, chose Z because…"). Senior signal.
- **Naming the failure mode + recovery** (Stoakes's turf): PITR, what a bad write does, why rollback is guaranteed-consistent.
- **Operational simplicity** — "no undifferentiated heavy lifting" (Idziorek's exact phrase): Serverless v2 autoscaling, IAM auth over managed secrets.
- **Cost alongside performance** (Stoakes literally presents this).
- **Honest scope** — "here's what we'd harden for prod" beats overclaiming.

**Punishes:**
- ❌ "Postgres because it's what we know" — junior tell.
- ❌ JSONB as a schema replacement / "schemaless = no design" — fastest way to lose Idziorek. JSONB is a *deliberate read-path cache alongside a normalized source of truth*, never a dumping ground.
- ❌ Name-dropping DSQL/DynamoDB admiringly when you didn't use them — Idziorek is *on the DSQL team*; he'll ask "so why didn't you?" Only name them as considered-and-rejected.
- ❌ Claiming active-active / multi-region strong consistency / "infinite scale" you didn't build — Stoakes built the layer that does these; he knows the cost.
- ❌ "It just scales" — they'll ask "to what, and what breaks first?" Have one honest answer (connection limits / graph size / edge write contention).
- ❌ Glossing dual-write sync — say **"same transaction"** or Stoakes spots the hole.

---

## 4. Pitch Playbook (for our Aurora-PostgreSQL hybrid)

**The one sentence to repeat** (built from their own language):
> *"We modeled the storage to two access patterns: a JSONB snapshot for the hot read path — load the whole graph in one request — and normalized node/edge tables as the source of truth for structural diff, joins, and referential integrity. Both writes happen in one Aurora transaction, so a branch or rollback is always consistent."*

This hits Idziorek's "model to access patterns / single request" AND Stoakes's "consistent, survives failure." Lead with it.

**In the 3-min video:**
1. **Access patterns first, model second** (Idziorek's mental order): (a) editor load = read whole graph fast → JSONB, one request; (b) version control = diff/branch/rollback needs structural comparison → normalized `nodes`/`edges` you can JOIN, set-diff, FK-constrain. Hybrid is the *consequence* of two reads, not a hedge.
2. **Show rollback as a transaction, out loud:** "Restoring a branch rewrites the JSONB snapshot and the node/edge rows in the *same* transaction — they can't drift." Closes the dual-write hole before it's raised.
3. **One honest scale sentence:** "Hot read is an O(1) row fetch regardless of graph size; structural diff is bounded by changed nodes, not total nodes."

**Architecture diagram — draw and label:**
- Vercel (v0 frontend) → API → **Aurora PostgreSQL Serverless v2**.
- Inside Aurora: `flow_snapshots(flow_id, version, graph JSONB)` with **GIN index** note; `nodes` + `edges` tables with an **FK arrow** (`edges.source_id → nodes.id`) labeled *referential integrity*.
- A **single-transaction boundary** box around a write touching both stores — the diagram's money detail.
- Auth arrow: **OIDC federation (Vercel Marketplace) → RDS IAM authentication** — no long-lived password.
- A small **PITR** badge on the cluster.

**Terms to name-drop credibly (all defensible):** Aurora Serverless v2 (autoscale, scale-to-low) · JSONB + GIN index (*say why*: indexable containment/key lookups, not a blob) · normalized tables + FKs (integrity a blob can't give) · single transaction / ACID · point-in-time recovery · RDS IAM auth + OIDC federation via Vercel Marketplace · (advanced) structural diff via SQL set ops / `EXCEPT` on node/edge sets.

**The trade-off slide that wins the panel (say explicitly):**
- **Why not DynamoDB?** "Our core op is *structural diff* — comparing two graph versions node/edge-by-edge — a relational set operation with referential integrity. DynamoDB has no JOINs/FKs; we'd rebuild graph integrity in app code. The access pattern is relational, so we chose a relational engine." *(Idziorek's own logic in reverse — he'll respect it.)*
- **Why not Aurora DSQL?** "DSQL is right for active-active multi-region distributed SQL. We're single-region with a graph-heavy relational workload; we don't need distributed write scaling, and DSQL's constraints aren't worth trading away mature Postgres features (JSONB+GIN, FKs, rich transactions)." *(Names DSQL as considered-and-rejected — protects us from the judge literally on the DSQL team.)*
- **Why hybrid?** "Pure JSONB can't enforce edge→node integrity or diff efficiently; pure-normalized makes the editor load a multi-table reassembly. We pay one extra transactional write to get both fast loads and real integrity."

**Claims to AVOID:** "JSONB means no schema" (→ "JSONB is the read-cache; normalized tables are the schema-of-record") · "infinite/massive scale," "active-active," "multi-region strong consistency" (stay honest: single-region Aurora) · "Postgres because we know it" · hand-wavy JSONB↔table sync (→ "same transaction") · over-praising DSQL/DynamoDB as better-but-skipped.

**Tailor the room:** *Idziorek* → access-pattern modeling, single-request hot read, serverless zero-ops, "no undifferentiated heavy lifting." *Stoakes* → transactional consistency of dual writes, PITR/recovery, perf-with-cost (Serverless v2). Bonus for Stoakes: the graph store as substrate for an agent that *modifies* automations (his agentic-AI-on-Aurora frontier).

---

## 5. Sources
Devpost judges section (https://h01.devpost.com/) · per-judge: LinkedIn, AWS Database Blog author/byline pages, re:Invent session pages/YouTube, ODBMS Q&A, Amazon Science. Specific URLs inline above. Verbatim quotes are attributed; unverified items flagged in §1 (could-not-verify) and §2 (Stoakes).
