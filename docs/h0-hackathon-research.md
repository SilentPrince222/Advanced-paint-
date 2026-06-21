# H0 Hackathon — Fact-Checked Briefing

*Companion to `roadmap-spec-ready.md`. Compiled 2026-06-21 via deep-research harness (5 search angles → 15 primary sources → 25 claims adversarially verified, 24 confirmed / 1 killed). Every load-bearing fact below is backed by the hackathon's own Devpost pages or AWS/Vercel official blogs. Confidence tags and a "could-not-verify" section are included on purpose — read §9 before trusting anything marginal.*

---

## 0. TL;DR — The 10 facts that change our plan

1. **Full name:** *H0: Hack the Zero Stack with Vercel v0 and AWS Databases* — **first edition.** No past winners exist.
2. **Deadline: June 29, 2026, 5:00pm PDT** (= June 30, 9:00am JST). As of compile date that is **~8 days left.**
3. **⚠️ Credit window closes EARLIER — ~June 26, 12pm PT, while supplies last.** Request the **$100 AWS + $30 v0 credits NOW**, not at the deadline. ~5 days.
4. **⚠️ Aurora PostgreSQL is NOT mandatory.** It is *one of three* allowed AWS DBs (Aurora PostgreSQL **/** Aurora DSQL **/** DynamoDB). Our roadmap treated it as required — it's a *deliberate choice*, which is actually stronger framing (see §8).
5. **⚠️ The #H0Hackathon tag is NOT a hard requirement.** It's *bonus points* — build-in-public content earns up to **+0.6** (0.2 × 3 pieces) on a 1.0–5.6 scale. Free ~11% — do it, but it's not a gate.
6. **Judges are ~10 AWS people, database-heavy** (Joseph Idziorek — Director of PM, AWS Databases; Tim Stoakes — Sr. Principal Technologist). **No confirmed Vercel judge.** → They will scrutinize the *data model* hardest. Lean into it.
7. **Prize pool $160,000** = $80k cash + $80k AWS credits. Per track: **1st $10k+$10k / 2nd $5k+$5k / 3rd $3k+$3k.** Plus 4 special prizes $2k+$2k each. **A project wins only ONE prize.**
8. **Four tracks.** We are **Track 2 — Monetizable B2B** (finance/tech/healthcare/insurance/marketing). Confirmed it exists and matches our framing.
9. **Judging = pass/fail viability gate, THEN 4 equally-weighted criteria** (Technical Implementation, Design, Impact & Real-World Applicability, Originality). No 25/25/25/25 published — just "equally weighted."
10. **Required deliverables:** demo video **< 3 min** (YouTube preferred), **architecture diagram**, link to **published Vercel project**, **screenshot proving AWS DB usage**, **Vercel Team ID**. (Public GitHub repo mandate could NOT be verified — see §9.)

---

## 1. Identity & Logistics  `confidence: high (3-0)`

| Field | Value |
|-------|-------|
| Official name | **H0: Hack the Zero Stack with Vercel v0 and AWS Databases** |
| Edition | **First edition** (no prior winners) |
| Host / Sponsor | **AWS** (Sponsor, Seattle WA) + **Vercel** (co-sponsor) |
| Administrator | **Devpost, Inc.** |
| Format | **Online / Public** (~7,375 participants registered) |
| Registration & submission | **https://h01.devpost.com/** |
| Registration + build window | May 27, 2026 (11am PT) → June 29, 2026 (5:00pm PDT) |
| **Submission deadline** | **June 29, 2026, 5:00pm PDT** (= June 30, 9:00am JST) |
| Judging period | June 30 → July 24, 2026 |
| Winners announced | on/around **July 31, 2026** (2pm PT) |

Sources: h01.devpost.com/ · h01.devpost.com/rules · aws.amazon.com/blogs/database/ai-native-full-stack-web-apps-with-vercel-and-aws-databases/ · jawsug-saga.connpass.com/event/395780/

---

## 2. Tracks  `confidence: high (3-0)`

Four tracks. A project enters **one**. We are **Track 2**.

| # | Track | Scope / qualifying sectors |
|---|-------|----------------------------|
| 1 | **Monetizable B2C App** | ecommerce, travel, retail, hospitality |
| **2** | **★ Monetizable B2B App** | **finance, technology, healthcare, insurance, marketing/advertising — or any sector**. A business-to-business app solving company-facing problems. |
| 3 | **Million-Scale Global App** | gaming, social media, entertainment; must scale to millions of users globally |
| 4 | **Open Innovation** | any full-stack app creatively using the Vercel/v0 + AWS Databases stack |

Our billing/revenue-flow (Stripe) automation platform → squarely Track 2 (finance + technology). ✅ Roadmap framing holds.

Sources: h01.devpost.com/rules · h01.devpost.com/ · AWS database blog.

---

## 3. Hard Requirements & Submission Checklist  `confidence: high (3-0)`

**Technical gates (must satisfy):**
- ✅ Use **one of three AWS databases as the primary backend**: **Aurora PostgreSQL** *or* **Aurora DSQL** *or* **DynamoDB**. More than one DB is allowed (FAQ: yes).
- ✅ Deploy the **frontend on Vercel or v0.app**. v0 is **recommended but optional** — manual Next.js / Nuxt / SvelteKit / Astro / Remix on Vercel is allowed.

**Required submission items:**
- 🎥 Demo video **under 3 minutes** (YouTube preferred)
- 🗺️ **Architecture diagram**
- 🔗 Link to the **published Vercel project**
- 📸 **Screenshot proving AWS Database usage** (e.g. Storage config in v0/Vercel)
- 🆔 **Vercel Team ID**

**Bonus (not mandatory):** build-in-public content tagged **#H0Hackathon** → up to **+0.6** points (0.2 each, ~3 pieces).

> ⚠️ **Corrected assumptions vs `roadmap-spec-ready.md` §0:**
> - Roadmap said "AWS database = Aurora PostgreSQL" as a *hard requirement.* → **Wrong.** Aurora PostgreSQL is one valid option among three. Our choice of it is now an *argument we make*, not a box we tick (good — see §8).
> - Roadmap listed "#H0Hackathon" under *hard requirements.* → **Wrong.** It's a bonus, worth +0.6.
> - A **public GitHub repo** as a mandatory item was **REFUTED** (1-2 vote, unconfirmed) — re-check the live rules page before submission.

Sources: h01.devpost.com/rules · h01.devpost.com/resources · AWS database blog.

---

## 4. Prize Structure  `confidence: high (3-0)`

**Total: $160,000 = $80,000 cash + $80,000 AWS credits.**

**Per track** (×4 tracks):

| Place | Cash | AWS credits |
|-------|------|-------------|
| 1st | $10,000 | $10,000 |
| 2nd | $5,000 | $5,000 |
| 3rd | $3,000 | $3,000 |

**Special prizes** (4 total, cross-track): **Best Technical Implementation · Best Design · Most Impactful · Most Original** — each **$2,000 cash + $2,000 credits**.

- **A project is eligible to win only ONE prize.** (So a Track-2 winner does *not* also collect a special prize — strategize the strongest single category.)
- Math check: (4 × $18k tracks) + (4 × $4k specials) = $72k + $8k = $80k cash, matched in credits = $160k. ✅
- **Per-registrant credits:** $100 AWS promotional credits + $30 v0 credits (while supplies last). New AWS customers may access a separate $100 offer.

Sources: h01.devpost.com/ · /rules · /resources · AWS database blog.

---

## 5. Judging  `confidence: high (3-0 on criteria; 2-1 on judge affiliation)`

**Two-stage process:**

**Stage 1 — pass/fail viability gate.** Does it fit the theme and actually apply the required APIs/SDKs (AWS DB + Vercel)? Fail = out, regardless of polish.

**Stage 2 — four EQUALLY-weighted criteria:**

| Criterion | What it rewards (our read) |
|-----------|----------------------------|
| **Technical / Technological Implementation** | AWS DB integrated with a *deliberate* data model / architecture. **← our strongest lane given DB-heavy judges.** |
| **Design** | UX quality, polish. |
| **Impact & Real-World Applicability** | Shippable, solves a real problem (NB: official name is "Impact & Real-World Applicability", not "Impact/Shippability"). |
| **Originality** | Novelty. **← the Git-versioning star lives here.** |

- **No published numeric weights** — only "equally weighted." Don't assume exactly 25% each beyond that.
- **Bonus:** up to **+0.6** for published build-in-public content (0.2 each).
- **Final score range: 1.0 – 5.6.**

**The judges (strategic intel):** ~10 named individuals, **all appear to be AWS personnel**, including:
- **Joseph Idziorek** — Director, Product Management, AWS Databases
- **Tim Stoakes** — Sr. Principal Technologist
- Others: Vijayraghavan, Samant, Castro, Gibbs, Bhatia, Yadav, Balasubramanian, Anand (all AWS)

> 🎯 **Implication:** The panel is dominated by AWS **database** leadership. They will judge the *data model* with expert eyes. Our §2.3 hybrid (JSONB snapshot + normalized node/edge tables) + the explicit "why Postgres over DynamoDB for graph+version semantics" argument is **exactly** the kind of deliberate choice this panel rewards. **Make that argument loud, in the demo video and the architecture diagram.** No judge is confirmed as Vercel staff — so DB sophistication likely outweighs frontend flash, though Design is still 1 of 4.

Sources: h01.devpost.com/rules · h01.devpost.com/.

---

## 6. Sponsors & The Stack  `confidence: high (3-0 on roles)`

- **AWS** (Sponsor): provides the DB services, **$100 credits/participant**, and the judging panel.
- **Vercel** (co-sponsor): provides hosting + v0, **$30 v0 credits/participant**.
- **Devpost** (Administrator): registration + submission platform.

Built on the **GA Vercel ↔ AWS Databases integration** (live since Jan 15, 2026): one-click native provisioning from the Vercel dashboard / v0 covers **exactly the three eligible DBs** — Aurora PostgreSQL, Aurora DSQL, DynamoDB.

- **Aurora PostgreSQL** has a **native Vercel Marketplace integration** via **OIDC Federation + RDS IAM auth** (`vercel.com/marketplace/aws/aws-apg`). → This *directly solves* the Vercel-serverless→Aurora connection/credentials pain flagged in our earlier discussion. Use the native integration, not a hand-rolled connection string.

Sources: AWS database blogs (ai-native / vibe-code) · vercel.com/marketplace/aws/aws-apg · vercel.com/blog/aws-databases-are-now-live-on-the-vercel-marketplace-and-v0 · aws.amazon.com/about-aws/whats-new/2026/01/aws-databases-available-vercel-v0/.

---

## 7. Past Winners  `confidence: high (3-0 on "none exist")`

**There are none — this is the first edition.** No prior winning projects, no track-level winning patterns from this event.

**Adjacent reference points** (found but NOT verified as predictive — use as inspiration only):
- Convex "Zero to One" hackathon winners (`stack.convex.dev/hackathon-winners-fall-2024`)
- Vercel hackathon winners (`vercel.com/blog/hackathon-winners`)
- `foru-ms-v0.devpost.com` (a v0-built project listing)

**How to infer "what wins" without history:** read it off the rubric + the judge panel (see §8). For first-edition AWS/Vercel hackathons, judges reward (a) a *deliberate, non-trivial data model* on the AWS DB, (b) a genuinely *shippable* real-world use case, (c) *originality* the incumbents lack, (d) clean v0/Vercel UX. Our roadmap already aims at exactly this.

---

## 8. Strategic Implications for Our Project

**Where the research moves the plan:**

1. **Timeline is the constraint, now quantified: ~8 days to submit, ~5 days to grab credits.** This forces the scope-cut discussion from `roadmap-spec-ready.md` §3. With 8 days and 2 builders, realistically defend **rungs 0–3 (the star) + rung 5 (the honesty climax)** and *fake* what's expensive. Rung 4 (real Stripe) can be a single rehearsed real call + recorded response.

2. **Lean HARD into the data model — the judges are AWS DB leaders.** Our hybrid JSONB+normalized Aurora design and the "graph+version needs relational joins *and* JSONB, a poor fit for DynamoDB" argument is our highest-leverage point for the *Technical Implementation* criterion. Put the architecture diagram and that one-paragraph justification front-and-center.

3. **Aurora PostgreSQL is now a *narrative asset*, not a constraint.** "We could have used DynamoDB; we chose Aurora PostgreSQL deliberately because version-control semantics are relational" — that *is* the deliberate-data-model story judges score.

4. **Use the native Vercel↔Aurora Marketplace integration** (OIDC + RDS IAM). It removes the serverless-connection-limit risk we flagged and is itself "the integration the hackathon showcases."

5. **#H0Hackathon build-in-public is +0.6 free points.** Cheap insurance in a close race. Post 3 build-in-public updates tagged #H0Hackathon during the remaining days.

6. **Pick ONE prize lane.** A project wins only one prize. Our strongest single shot: **Track 2 (B2B) placement**, with the Git-versioning **Originality** and the data-model **Technical Implementation** as the two pillars carrying it. The 3-min video must land the `branch → diff → rollback → "the charge still fired"` beat.

7. **Submission logistics are themselves work:** < 3-min video, architecture diagram, published Vercel link, AWS-DB-usage screenshot, Vercel Team ID. Budget half a day at the end for these — they are graded gates, not afterthoughts.

---

## 9. Caveats & Open Questions (verify against the live rules before submitting)

- **Aurora PostgreSQL is NOT mandatory** — it's one of three eligible AWS DBs. (Original briefing's "Aurora specifically" assumption was REFUTED by multiple primary sources.)
- **Criteria are "equally weighted"** with **no published numeric percentages**; official names are *Technical/Technological Implementation, Design, Impact & Real-World Applicability, Originality* (not "Impact/Shippability").
- **Public GitHub repo as a mandatory item: UNCONFIRMED** (claim refuted 1-2). Architecture diagram + AWS-DB screenshot are confirmed required; a public-repo mandate could not be verified. **Re-check the live rules page.**
- **#H0Hackathon is bonus, not mandatory** (+0.6 max).
- **Vercel judge representation: UNCONFIRMED** — all ~10 named judges appear to be AWS staff. Is Vercel judging at all, or only sponsoring credits/hosting?
- **Credit-request mechanics:** exact cap / first-come-first-served status unconfirmed; window ~June 26 12pm PT, while supplies last. The $30 v0 credit may require a separate Vercel-side request from the $100 AWS credit. **Act early.**
- **No past-winner data exists** (first edition); the "what wins" guidance in §7 is inferred from rubric + panel, not from historical results.

---

## 10. Sources (primary unless noted)

- `https://h01.devpost.com/` — homepage (prizes, tracks, judges)
- `https://h01.devpost.com/rules` — official rules (dates, criteria, requirements)
- `https://h01.devpost.com/resources` — resources/FAQ (stack, credits, submission)
- `https://aws.amazon.com/blogs/database/ai-native-full-stack-web-apps-with-vercel-and-aws-databases/` — AWS announcement
- `https://aws.amazon.com/blogs/database/vibe-code-with-aws-databases-using-vercel-v0/` — AWS v0 tutorial set
- `https://vercel.com/marketplace/aws/aws-apg` — Aurora PostgreSQL native Vercel integration
- `https://vercel.com/blog/aws-databases-are-now-live-on-the-vercel-marketplace-and-v0` — integration GA (Jan 15, 2026)
- `https://aws.amazon.com/about-aws/whats-new/2026/01/aws-databases-available-vercel-v0/` — AWS What's New
- `https://jawsug-saga.connpass.com/event/395780/` — JST deadline localization
- Secondary/inspiration: `stack.convex.dev/hackathon-winners-fall-2024` · `vercel.com/blog/hackathon-winners` · `foru-ms-v0.devpost.com`
