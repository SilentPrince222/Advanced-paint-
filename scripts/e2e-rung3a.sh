#!/usr/bin/env bash
# e2e-rung3a.sh — Rung-3a end-to-end: field-level diff engine
#   Postgres → init-db → build → next start →
#   PUT fixture100 (n1..n4, e1..e3) → commit "v1" capture C1 →
#   PUT fixture90-drop-n4 (amount 90, remove n4+e3) → commit "v2" capture C2 →
#   GET /diff?from=C1&to=C2 → assert nodes.modified has n3 with {field:"params.amount",before:100,after:90}
#                           → assert nodes.removed has n4
#                           → assert edges.removed has e3 →
#   GET /diff?from=C2&to=C1 → assert nodes.added has n4 →
#   GET /diff?from=C1&to=bogus → assert HTTP 400

set -euo pipefail

PG_CONTAINER="pg-test-rung3a"
PORT=3102
SERVER_PID=""

# trap installed BEFORE docker run / server start so early failures still clean up
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
  -p 5434:5432 \
  postgres:16

# Clear any inherited Aurora URL BEFORE pointing at local Docker pg
unset DATABASE_URL
export DATABASE_URL="postgresql://app:secret@localhost:5434/flows"

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

# §8 fixture — amount 100, 4 nodes, 3 edges
FIXTURE_100='{
  "nodes": [
    {"id":"n1","type":"trigger.webhook","params":{},"isDraftSafe":true},
    {"id":"n2","type":"condition.if","params":{"expression":"plan == '\''pro'\''"},"isDraftSafe":true},
    {"id":"n3","type":"action.stripe.charge","params":{"amount":100,"currency":"usd"},"isDraftSafe":false},
    {"id":"n4","type":"action.slack.post","params":{"channel":"#revenue","message":"New charge"},"isDraftSafe":true}
  ],
  "edges": [
    {"id":"e1","fromNodeId":"n1","toNodeId":"n2"},
    {"id":"e2","fromNodeId":"n2","toNodeId":"n3","condition":"true"},
    {"id":"e3","fromNodeId":"n3","toNodeId":"n4"}
  ],
  "views": [
    {"nodeId":"n1","x":100,"y":200,"width":160,"height":80},
    {"nodeId":"n2","x":340,"y":200,"width":160,"height":80},
    {"nodeId":"n3","x":580,"y":200,"width":160,"height":80},
    {"nodeId":"n4","x":820,"y":200,"width":160,"height":80}
  ]
}'

# §8 fixture — amount 90, n4 removed, e3 removed
FIXTURE_90_DROP_N4='{
  "nodes": [
    {"id":"n1","type":"trigger.webhook","params":{},"isDraftSafe":true},
    {"id":"n2","type":"condition.if","params":{"expression":"plan == '\''pro'\''"},"isDraftSafe":true},
    {"id":"n3","type":"action.stripe.charge","params":{"amount":90,"currency":"usd"},"isDraftSafe":false}
  ],
  "edges": [
    {"id":"e1","fromNodeId":"n1","toNodeId":"n2"},
    {"id":"e2","fromNodeId":"n2","toNodeId":"n3","condition":"true"}
  ],
  "views": [
    {"nodeId":"n1","x":100,"y":200,"width":160,"height":80},
    {"nodeId":"n2","x":340,"y":200,"width":160,"height":80},
    {"nodeId":"n3","x":580,"y":200,"width":160,"height":80}
  ]
}'

echo "==> PUT /api/flows/demo (fixture amount=100, 4 nodes, 3 edges)..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_100}" \
  "http://localhost:${PORT}/api/flows/demo"
echo ""

echo "==> POST /api/flows/demo/commit {authorNote:'v1'}..."
COMMIT1_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"v1"}' \
  "http://localhost:${PORT}/api/flows/demo/commit")
echo "COMMIT1 response: ${COMMIT1_RESP}"

C1=$(node --input-type=module <<EOF
const d = ${COMMIT1_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit1 has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "C1 = ${C1}"

echo "==> PUT /api/flows/demo (fixture amount=90, n4 removed, e3 removed)..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_90_DROP_N4}" \
  "http://localhost:${PORT}/api/flows/demo"
echo ""

echo "==> POST /api/flows/demo/commit {authorNote:'v2'}..."
COMMIT2_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"v2"}' \
  "http://localhost:${PORT}/api/flows/demo/commit")
echo "COMMIT2 response: ${COMMIT2_RESP}"

C2=$(node --input-type=module <<EOF
const d = ${COMMIT2_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit2 has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "C2 = ${C2}"

echo "==> GET /api/flows/demo/diff?from=C1&to=C2 — assert §8 oracle..."
DIFF_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/diff?from=${C1}&to=${C2}")
echo "DIFF response: ${DIFF_RESP}"

node --input-type=module <<EOF
const diff = ${DIFF_RESP};
const errors = [];

// n3 must be in nodes.modified with fieldChange params.amount 100→90
const n3mod = (diff.nodes?.modified || []).find((m) => m.id === "n3");
if (!n3mod) {
  errors.push("nodes.modified does not contain n3");
} else {
  const amountFc = (n3mod.fieldChanges || []).find((fc) => fc.field === "params.amount");
  if (!amountFc) {
    errors.push("n3.fieldChanges does not contain params.amount");
  } else {
    if (amountFc.before !== 100) errors.push(\`params.amount before: expected 100, got \${amountFc.before}\`);
    if (amountFc.after !== 90)  errors.push(\`params.amount after: expected 90, got \${amountFc.after}\`);
  }
}

// n4 must be in nodes.removed
const n4removed = (diff.nodes?.removed || []).find((n) => n.id === "n4");
if (!n4removed) errors.push("nodes.removed does not contain n4");

// e3 must be in edges.removed
const e3removed = (diff.edges?.removed || []).find((e) => e.id === "e3");
if (!e3removed) errors.push("edges.removed does not contain e3");

if (errors.length > 0) {
  console.error("ASSERTION FAILED (C1→C2 diff):", errors.join("; "));
  process.exit(1);
}
console.log("DIFF C1→C2 ASSERTIONS PASSED");
EOF

echo "==> GET /api/flows/demo/diff?from=C2&to=C1 — assert n4 re-appears in nodes.added..."
DIFF_REVERSE_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/diff?from=${C2}&to=${C1}")
echo "DIFF REVERSE response: ${DIFF_REVERSE_RESP}"

node --input-type=module <<EOF
const diff = ${DIFF_REVERSE_RESP};
const errors = [];

const n4added = (diff.nodes?.added || []).find((n) => n.id === "n4");
if (!n4added) errors.push("nodes.added does not contain n4 in reverse diff (C2→C1)");

if (errors.length > 0) {
  console.error("ASSERTION FAILED (C2→C1 diff):", errors.join("; "));
  process.exit(1);
}
console.log("DIFF C2→C1 ASSERTIONS PASSED");
EOF

echo "==> GET /api/flows/demo/diff?from=C1&to=bogus — assert HTTP 400..."
BOGUS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/flows/demo/diff?from=${C1}&to=bogus")
echo "BOGUS diff status: ${BOGUS_STATUS}"

if [[ "${BOGUS_STATUS}" -ne 400 ]]; then
  echo "ASSERTION FAILED: expected 400 for bogus to-commit, got ${BOGUS_STATUS}"
  exit 1
fi
echo "BOGUS COMMIT 400 ASSERTION PASSED"

echo "==> e2e-rung3a PASSED"
