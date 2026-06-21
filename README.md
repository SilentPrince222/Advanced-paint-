# Advanced Paint — Visual Automation Builder

A B2B automation platform: **draw** a process on a canvas, wire its logic from snap-together blocks, and get **Git-style version control over the automation graph** — branch, field-level structural diff, rollback.

Built for the **H0 hackathon** (Track 2 · B2B · Vercel v0 + AWS Databases).

## The differentiator
Automations today are un-versioned "set it and pray" scripts. We make them branchable, diffable, reviewable infrastructure — and we're honest about the one thing version control can't undo: a real-world consequence (the immutable execution log proves *definition rollback ≠ consequence rollback*).

## Stack
TypeScript everywhere · Next.js (App Router) on **Vercel** ↔ **Aurora PostgreSQL** (Serverless v2) direct, via the native Vercel↔Aurora Marketplace integration · one AWS **Lambda** as the "consequence engine" for irreversible actions · Secrets Manager/KMS vault.

## Docs
- [docs/SPEC.md](docs/SPEC.md) — build spec (software + how to build it)
- [docs/PRESENTATION.md](docs/PRESENTATION.md) — demo script, submission deliverables, pitch playbook
- [docs/roadmap-spec-ready.md](docs/roadmap-spec-ready.md) — the roadmap this implements
- [docs/h0-hackathon-research.md](docs/h0-hackathon-research.md) — hackathon fact base
- [docs/h0-judges.md](docs/h0-judges.md) — judge intel
