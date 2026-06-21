# Visual Automation Builder — Presentation & Pitch (H0)

*Everything aimed at the judges: the demo story, the submission deliverables, and the pitch playbook for a database-expert panel. The software spec is `SPEC.md`; the fact base is `h0-hackathon-research.md` + `h0-judges.md`.*

---

## 1. The demo (3-minute story — billing / revenue flow)

**Flow:** `trigger.webhook (new subscription)` → `condition.if (plan == "pro")` → `action.stripe.charge (amount: 100 usd)` → `action.slack.post (#revenue)`.

**Beats:**
1. Show the flow on `main`. Run once → Slack post + a charge appears in the log.
2. "Finance wants a 10% launch discount." **Branch** `discount-launch`.
3. On the branch, edit the charge `amount: 100 → 90`. **Diff** `main ↔ discount-launch` → the app highlights exactly `amount: 100 → 90`.
4. Run the branch → a *second* charge (90) lands in the immutable log.
5. "Wait — wrong discount." **Rollback** the definition to `main`. The graph reverts instantly.
6. **Climax:** open the execution log — the 90 charge is *still there*.
   > *"We rolled back the plan in one click. The money we took is still taken. Reverting a definition is not reversing a consequence — and our log proves it, because the database itself won't let us erase it."*
   (Optional: drop to `psql`, try `UPDATE exec_log …`, show the `exec_log is append-only` exception.)

**One-sentence frame:** *Automations today are un-versioned "set it and pray" scripts. We make them branchable, diffable, reviewable infrastructure — and we're honest about the one thing version control can't undo: a real-world consequence.*

---

## 2. Submission deliverables (checklist)

- [ ] Demo video **< 3 min** (the §1 story; lead with the diff, end on the climax)
- [ ] Architecture diagram (the balanced-A diagram from `SPEC.md` §1, cleaned up)
- [ ] Link to the **published Vercel project**
- [ ] Screenshot proving **AWS-DB usage** (Aurora console / a query against the live DB)
- [ ] **Vercel Team ID**
- [ ] Build-in-public content tagged **#H0Hackathon** (bonus up to +0.6, ~11% — optional, ~free)

Ship with buffer before **June 29, 17:00 PDT** — not at 16:59.

---

## 3. Pitch playbook for the DB-expert panel

The panel is ~10 AWS people, database-heavy (Idziorek, Stoakes…), no confirmed Vercel judge → they scrutinize the **data model**. Score where they look.

- **Lead with the trade-off slide:** *why not DynamoDB (no joins/FK for a live graph), why not DSQL (we need JSONB **and** relational together), why the hybrid.* This is the move that wins **Technical Implementation**.
- **Say "in one transaction"** whenever you describe writing the snapshot + the live tables — pre-empt the dual-write integrity question (Stoakes will look for it).
- **Name-drop where true:** Aurora Serverless v2, JSONB + GIN, PITR, RDS IAM auth, append-only via `REVOKE` + trigger, scoped IAM for draft/prod isolation.
- **The honesty climax is your Originality + Impact play:** "definition rollback ≠ consequence rollback," proven by a DB-enforced immutable log.
- **Avoid:** "infinite scale," "we replaced the schema with JSON," anything that reads as hand-waving to people who build these databases for a living.

**Where we score** (one prize per project → aim Track 2 placement):
| Lever | Criterion |
|---|---|
| Hybrid Aurora data model | Technical Implementation |
| Git-versioning of flows (the star) | Originality |
| "Definition rollback ≠ consequence rollback" | Impact & Real-World Applicability |

---

## 4. 3-minute video script

*To be written — say the word and I'll draft it line-by-line against the §1 beats, with shot/screen cues and a word budget that fits under 3:00.*
