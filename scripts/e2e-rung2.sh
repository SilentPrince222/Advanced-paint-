#!/usr/bin/env bash
# e2e-rung2.sh — Rung-2 end-to-end: commit history + forward rollback
#   Postgres → init-db → build → next start →
#   PUT fixture (amount 100) → POST commit "v1 amount 100" (capture C1) →
#   PUT fixture (amount 90)  → POST commit "v2 amount 90" →
#   GET commits assert length>=2 & newest authorNote contains "v2" →
#   POST rollback {toCommitId:C1} →
#   GET /api/flows/demo assert n3 params.amount===100 →
#   GET commits assert length===3
#   psql: commit count==3 and branch head == rollback commit id

set -euo pipefail

PG_CONTAINER="pg-test-rung2"
PORT=3101
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
  -p 5433:5432 \
  postgres:16

# Clear any inherited Aurora URL BEFORE pointing at local Docker pg
unset DATABASE_URL
export DATABASE_URL="postgresql://app:secret@localhost:5433/flows"

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

# §8 fixture — amount 100
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

# §8 fixture — amount 90
FIXTURE_90='{
  "nodes": [
    {"id":"n1","type":"trigger.webhook","params":{},"isDraftSafe":true},
    {"id":"n2","type":"condition.if","params":{"expression":"plan == '\''pro'\''"},"isDraftSafe":true},
    {"id":"n3","type":"action.stripe.charge","params":{"amount":90,"currency":"usd"},"isDraftSafe":false},
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

echo "==> PUT /api/flows/demo (fixture amount=100)..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_100}" \
  "http://localhost:${PORT}/api/flows/demo"
echo ""

echo "==> POST /api/flows/demo/commit {authorNote:'v1 amount 100'}..."
COMMIT1_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"v1 amount 100"}' \
  "http://localhost:${PORT}/api/flows/demo/commit")
echo "COMMIT1 response: ${COMMIT1_RESP}"

C1=$(node --input-type=module <<EOF
const d = ${COMMIT1_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit1 has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "C1 = ${C1}"

echo "==> PUT /api/flows/demo (fixture amount=90)..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_90}" \
  "http://localhost:${PORT}/api/flows/demo"
echo ""

echo "==> POST /api/flows/demo/commit {authorNote:'v2 amount 90'}..."
COMMIT2_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"v2 amount 90"}' \
  "http://localhost:${PORT}/api/flows/demo/commit")
echo "COMMIT2 response: ${COMMIT2_RESP}"

C2=$(node --input-type=module <<EOF
const d = ${COMMIT2_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit2 has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "C2 = ${C2}"

echo "==> GET /api/flows/demo/commits — assert length>=2 and newest authorNote contains 'v2'..."
COMMITS_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/commits")
echo "COMMITS response: ${COMMITS_RESP}"

node --input-type=module <<EOF
const commits = ${COMMITS_RESP};
const errors = [];
if (!Array.isArray(commits)) {
  errors.push("Expected an array");
} else {
  if (commits.length < 2) errors.push(\`Expected >=2 commits, got \${commits.length}\`);
  if (!commits[0]?.authorNote?.includes("v2")) {
    errors.push(\`Expected newest authorNote to contain 'v2', got: \${commits[0]?.authorNote}\`);
  }
}
if (errors.length > 0) {
  console.error("ASSERTION FAILED:", errors.join("; "));
  process.exit(1);
}
console.log("COMMITS ASSERTIONS PASSED");
EOF

echo "==> POST /api/flows/demo/rollback {toCommitId:C1}..."
ROLLBACK_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"toCommitId\":\"${C1}\"}" \
  "http://localhost:${PORT}/api/flows/demo/rollback")
echo "ROLLBACK response: ${ROLLBACK_RESP}"

ROLLBACK_COMMIT_ID=$(node --input-type=module <<EOF
const d = ${ROLLBACK_RESP};
if (!d.commit?.id) { console.error("ASSERTION FAILED: rollback response has no commit.id"); process.exit(1); }
console.log(d.commit.id);
EOF
)
echo "ROLLBACK_COMMIT_ID = ${ROLLBACK_COMMIT_ID}"

echo "==> GET /api/flows/demo — assert n3 params.amount===100..."
FLOW_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo")
echo "FLOW response: ${FLOW_RESP}"

node --input-type=module <<EOF
const doc = ${FLOW_RESP};
const n3 = (doc.nodes || []).find((n) => n.id === "n3");
if (!n3) { console.error("ASSERTION FAILED: n3 not found"); process.exit(1); }
if (n3.params?.amount !== 100) {
  console.error(\`ASSERTION FAILED: expected n3.params.amount===100, got \${n3.params?.amount} (type: \${typeof n3.params?.amount})\`);
  process.exit(1);
}
console.log("ROLLBACK RESTORE ASSERTION PASSED: n3.params.amount === 100");
EOF

echo "==> GET /api/flows/demo/commits — assert length===3..."
COMMITS_AFTER_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/commits")
echo "COMMITS AFTER response: ${COMMITS_AFTER_RESP}"

node --input-type=module <<EOF
const commits = ${COMMITS_AFTER_RESP};
const errors = [];
if (!Array.isArray(commits)) {
  errors.push("Expected an array");
} else {
  if (commits.length !== 3) errors.push(\`Expected 3 commits, got \${commits.length}\`);
}
if (errors.length > 0) {
  console.error("ASSERTION FAILED:", errors.join("; "));
  process.exit(1);
}
console.log("COMMITS AFTER ROLLBACK ASSERTION PASSED: length === 3");
EOF

echo "==> Asserting DB state..."
COMMIT_COUNT=$(docker exec "${PG_CONTAINER}" psql -U app -d flows -tAc 'select count(*) from "commit"')
HEAD=$(docker exec "${PG_CONTAINER}" psql -U app -d flows -tAc "select head_commit_id from branch where id='demo-main'")

echo "commit count: ${COMMIT_COUNT}"
echo "branch head: ${HEAD}"

if [[ "${COMMIT_COUNT}" -ne 3 ]]; then
  echo "ASSERTION FAILED: expected commit count == 3, got ${COMMIT_COUNT}"
  exit 1
fi

if [[ "${HEAD}" != "${ROLLBACK_COMMIT_ID}" ]]; then
  echo "ASSERTION FAILED: expected branch head == rollback commit id (${ROLLBACK_COMMIT_ID}), got ${HEAD}"
  exit 1
fi

echo "==> e2e-rung2 PASSED"
