#!/usr/bin/env bash
# e2e-rung0.sh — Rung-0 end-to-end: Postgres → init-db → build → next start → PUT/GET round-trip

set -euo pipefail

PG_CONTAINER="pg-test"
PORT=3100
SERVER_PID=""

# Δ2: trap installed BEFORE docker run / server start so early failures still clean up
cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
  docker rm -f "${PG_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Starting Postgres container..."
docker run --rm -d \
  --name "${PG_CONTAINER}" \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_USER=app \
  -e POSTGRES_DB=flows \
  -p 5432:5432 \
  postgres:16

export DATABASE_URL="postgresql://app:secret@localhost:5432/flows"

echo "==> Waiting for Postgres to be ready..."
until docker exec "${PG_CONTAINER}" pg_isready -U app -d flows -q; do
  sleep 0.5
done

echo "==> Running db:init..."
# rds_iam grant will fail on local Postgres — init-db.ts tolerates per-statement errors
npx tsx scripts/init-db.ts

echo "==> Building Next.js app..."
npm run build

echo "==> Starting Next.js server on port ${PORT}..."
npx next start -p "${PORT}" &
SERVER_PID=$!

echo "==> Waiting for server to be ready..."
until curl -sf "http://localhost:${PORT}/" >/dev/null 2>&1; do
  sleep 0.5
done

echo "==> PUT /api/flows/demo (2 nodes, 1 edge, 2 views)..."
PUT_BODY='{
  "nodes": [
    {"id":"n1","type":"trigger.schedule","params":{"cron":"0 * * * *"},"isDraftSafe":true},
    {"id":"n2","type":"action.slack.post","params":{"channel":"#demo","message":"hello"},"isDraftSafe":true}
  ],
  "edges": [
    {"id":"e1","fromNodeId":"n1","toNodeId":"n2"}
  ],
  "views": [
    {"nodeId":"n1","x":100,"y":200,"width":160,"height":80},
    {"nodeId":"n2","x":400,"y":200,"width":160,"height":80}
  ]
}'

PUT_RESP=$(curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${PUT_BODY}" \
  "http://localhost:${PORT}/api/flows/demo")

echo "PUT response: ${PUT_RESP}"

echo "==> GET /api/flows/demo..."
GET_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo")
echo "GET response: ${GET_RESP}"

echo "==> Asserting round-trip counts..."
node --input-type=module <<EOF
const data = ${GET_RESP};
const errors = [];
if (!Array.isArray(data.nodes) || data.nodes.length !== 2) errors.push(\`Expected 2 nodes, got \${data.nodes?.length}\`);
if (!Array.isArray(data.edges) || data.edges.length !== 1) errors.push(\`Expected 1 edge, got \${data.edges?.length}\`);
if (!Array.isArray(data.views) || data.views.length !== 2) errors.push(\`Expected 2 views, got \${data.views?.length}\`);
if (errors.length > 0) {
  console.error("ASSERTION FAILED:", errors.join("; "));
  process.exit(1);
}
console.log("ALL ASSERTIONS PASSED: nodes=2, edges=1, views=2");
EOF

echo "==> e2e-rung0 PASSED"
