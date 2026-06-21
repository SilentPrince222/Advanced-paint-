# Visual Automation Builder

## Verify your work
After any code change, run all of these from the project root before declaring a task done:

```bash
npx tsc --noEmit   # typecheck
npm run lint       # eslint
npm run build      # next build (uses Turbopack)
```

Dev server: `npm run dev` (http://localhost:3000).

## Stack
- Next.js 16 (App Router, `src/` dir, `@/*` alias) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui (preset: nova, base: radix, `src/components/ui/*`)
- @xyflow/react v12 (React Flow) — canvas must be client-rendered (`"use client"`, wrapped in `<ReactFlowProvider>`)
- Zustand v5 — canvas state in `src/lib/flow-store.ts`

## Conventions
- Single shared schema lives in `src/lib/types.ts` (node/edge/snapshot/field types). Add new block types, field types, and snapshot shapes there — do not scatter type defs across components.
- Editor components live in `src/components/editor/`. shadcn primitives live in `src/components/ui/`.
- Build in phases per `frontend-build-prompt.md`. Each phase must be demonstrable before starting the next.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
