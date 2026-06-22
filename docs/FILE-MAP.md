# File Map

A map of the automation-builder source so a new contributor (or Phase N) can
land in the right place fast. Mirrors the Data Contract (SPEC §2.1) and the
6-phase build plan.

## `src/lib/` — domain logic (pure, no React where possible)

| File | Role | Phase |
| --- | --- | --- |
| `types.ts` | **Single source of truth** for the schema — `LogicNode`, `LogicEdge`, `NodeView`, `GraphDocument`, `BlockFieldSchema`, `CanvasSnapshot`, `categoryOf()`. The two-layer split (logic vs. view) is foundational; the Phase 5 diff engine reads only the logic layer. | 1–5 |
| `block-registry.ts` | The 5 canonical demo block types (SPEC §2.5) + UI metadata (`UiBlockVariant`, `CATEGORY_STYLES`, `CATEGORY_ORDER`). Exposes `getVariant`, `getVariantsByCategory`, `defaultParamsFor`. Adding a node type is a one-file change here. | 2 |
| `flow-store.ts` | Zustand store: canvas state (`nodes`/`edges`), `addNode`, `updateNodeData`, `onConnect` (self-loop guard + `addEdge` dedupe). Thin wrappers over `graph-serialize` for `toGraphDocument`/`fromGraphDocument`. | 1, 2 |
| `graph-serialize.ts` | Pure canvas ⇄ Data Contract transforms. `toGraphDocument` strips React Flow metadata; `fromGraphDocument` coerces missing `isDraftSafe` (SPEC §6.0) and drops orphan edges. Independent of the store so Phase 4 (history) and Phase 5 (diff) reuse it. | refactor |
| `node-summary.ts` | `paramSummary` — compact one-line node caption (`100 · USD`, `#revenue`). Schema-driven; shared by the node card and the future SidePanel header. | refactor |
| `drop-payload.ts` | `parseDropPayload` — validates HTML drag payloads from the palette and guards against unknown types. | 2 |
| `utils.ts` | shadcn `cn()` class-merge helper. | 1 |

## `src/components/editor/` — canvas UI (client components)

| File | Role |
| --- | --- |
| `editor.tsx` | Top-level shell: wires `<ReactFlowProvider>` + layout (palette | canvas). `"use client"`. |
| `flow-canvas.tsx` | The React Flow canvas. Registers node types, wires store actions, renders `<Controls>`/`<Background>`. |
| `node-palette.tsx` | Draggable block palette grouped by `CATEGORY_ORDER`. Each item carries its `type` in the drag payload. |
| `base-node.tsx` | Single custom node renderer. Reads `categoryOf` + `getVariant` for styling, calls `paramSummary` for the caption. |

## `src/components/ui/`

shadcn primitives — **do not hand-edit**. Regenerate via the shadcn CLI when a
new primitive is needed.

## `docs/`

| File | Role |
| --- | --- |
| `SPEC.md` | Authoritative spec. §2.1 Data Contract, §2.5 param schemas, §5 component tree, §6.0 draft-safety rule. |
| `roadmap-spec-ready.md` | Phase-by-phase build plan. |
| `PRESENTATION.md` | Demo narrative + talking points. |
| `h0-hackathon-research.md`, `h0-judges.md` | Hackathon context / judging rubric. |
| `FILE-MAP.md` | This file. |

## `AGENTS.md`

Verify commands (`tsc`, `lint`, `test`, `build`), stack list, conventions.
**Read this before any code change.**

---

## Where things go (cheat-sheet)

| You want to… | Edit |
| --- | --- |
| Add a block type | `block-registry.ts` (entry in `BLOCK_REGISTRY`); if it has new params, also extend the field schema there. |
| Change the node card's look | `base-node.tsx` (+ `CATEGORY_STYLES` for category-wide accents). |
| Change what serializes | `graph-serialize.ts` (+ `types.ts` for the schema). |
| Change connect/delete behavior | `flow-store.ts`. |
| Add a new SidePanel field type | `types.ts` (`BlockFieldType`) + the SidePanel renderer (Phase 3). |
| Add a verify step | `AGENTS.md` + the relevant test file in `src/lib/*.test.ts`. |

## Test layout

Each pure module has a co-located `*.test.ts`. The store has its own behavior
tests (`flow-store.test.ts`); serialization is tested at the pure-function
layer in `graph-serialize.test.ts` and re-checked at the store layer with a
single thin round-trip test. `src/__sanity__/harness.test.ts` is the
Vitest+RTL wiring smoke test.

Run all of: `npx tsc --noEmit` → `npm run lint` → `npm run test` → `npm run build`.
