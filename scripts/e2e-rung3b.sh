#!/usr/bin/env bash
# e2e-rung3b.sh — Rung-3b end-to-end: branch model (fork → edit → diff → isolate → rollback)
#   Postgres → init-db → build → next start →
#   PUT demo fixture (amount 100) → commit "v1" capture C_MAIN →
#   POST /api/flows/demo/branches {name:"experiment",fromCommitId:C_MAIN} → capture B →
#   PUT /api/flows/demo?branch=B (amount 90) → commit ?branch=B "v2" capture C_BRANCH →
#   GET /diff?from=C_MAIN&to=C_BRANCH → assert nodes.modified n3 params.amount 100→90 →
#   GET /api/flows/demo (no ?branch = main) → assert amount STILL 100 (branch isolation, the key proof) →
#   cross-flow guard: PUT demo2 fixture (creates demo2-main) →
#                     PUT /api/flows/demo?branch=demo2-main → assert HTTP 400 (B-1 fix) →
#   POST /api/flows/demo/rollback?branch=B {toCommitId:C_MAIN} → assert 200 round-trips (amount 100 on branch B)

set -euo pipefail

PG_CONTAINER="pg-test-rung3b"
PORT=3103
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
  -p 5435:5432 \
  postgres:16

# Clear any inherited Aurora URL BEFORE pointing at local Docker pg
unset DATABASE_URL
export DATABASE_URL="postgresql://app:secret@localhost:5435/flows"

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

# §8 fixture — amount 90, same shape (4 nodes, 3 edges) — branch edit
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

echo "==> POST /api/flows/demo/commit {authorNote:'v1'} → C_MAIN..."
COMMIT_MAIN_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"v1"}' \
  "http://localhost:${PORT}/api/flows/demo/commit")
echo "COMMIT_MAIN response: ${COMMIT_MAIN_RESP}"

C_MAIN=$(node --input-type=module <<EOF
const d = ${COMMIT_MAIN_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit-main has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "C_MAIN = ${C_MAIN}"

echo "==> POST /api/flows/demo/branches {name:'experiment',fromCommitId:C_MAIN} → B..."
BRANCH_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"experiment\",\"fromCommitId\":\"${C_MAIN}\"}" \
  "http://localhost:${PORT}/api/flows/demo/branches")
echo "BRANCH response: ${BRANCH_RESP}"

B=$(node --input-type=module <<EOF
const d = ${BRANCH_RESP};
const errors = [];
if (!d.id) errors.push("branch has no id");
if (d.name !== "experiment") errors.push(\`expected name 'experiment', got \${d.name}\`);
if (d.headCommitId !== "${C_MAIN}") errors.push(\`expected headCommitId C_MAIN, got \${d.headCommitId}\`);
if (d.baseCommitId !== "${C_MAIN}") errors.push(\`expected baseCommitId C_MAIN, got \${d.baseCommitId}\`);
if (errors.length > 0) { console.error("ASSERTION FAILED (branch create):", errors.join("; ")); process.exit(1); }
console.log(d.id);
EOF
)
echo "B = ${B}"

echo "==> GET /api/flows/demo/branches — assert HTTP 200, length 2, names include main+experiment..."
BRANCH_LIST_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/branches")
echo "BRANCH_LIST response: ${BRANCH_LIST_RESP}"

node --input-type=module <<EOF
const list = ${BRANCH_LIST_RESP};
const errors = [];
if (!Array.isArray(list)) errors.push("branch list is not an array");
if (list.length !== 2) errors.push(\`expected length 2, got \${list.length}\`);
const names = list.map((b) => b.name).sort();
if (!names.includes("main")) errors.push(\`names missing 'main': \${names.join(",")}\`);
if (!names.includes("experiment")) errors.push(\`names missing 'experiment': \${names.join(",")}\`);
if (errors.length > 0) {
  console.error("ASSERTION FAILED (GET /branches):", errors.join("; "));
  process.exit(1);
}
console.log("GET /branches ASSERTION PASSED: length 2, names include main+experiment");
EOF

echo "==> PUT /api/flows/demo?branch=B (fixture amount=90)..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_90}" \
  "http://localhost:${PORT}/api/flows/demo?branch=${B}"
echo ""

echo "==> POST /api/flows/demo/commit?branch=B {authorNote:'v2'} → C_BRANCH..."
COMMIT_BRANCH_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"v2"}' \
  "http://localhost:${PORT}/api/flows/demo/commit?branch=${B}")
echo "COMMIT_BRANCH response: ${COMMIT_BRANCH_RESP}"

C_BRANCH=$(node --input-type=module <<EOF
const d = ${COMMIT_BRANCH_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit-branch has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "C_BRANCH = ${C_BRANCH}"

echo "==> GET /api/flows/demo/diff?from=C_MAIN&to=C_BRANCH — assert params.amount 100→90..."
DIFF_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/diff?from=${C_MAIN}&to=${C_BRANCH}")
echo "DIFF response: ${DIFF_RESP}"

node --input-type=module <<EOF
const diff = ${DIFF_RESP};
const errors = [];
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
if (errors.length > 0) {
  console.error("ASSERTION FAILED (cross-branch diff):", errors.join("; "));
  process.exit(1);
}
console.log("DIFF C_MAIN→C_BRANCH ASSERTIONS PASSED");
EOF

echo "==> GET /api/flows/demo (no ?branch = main) — assert amount STILL 100 (branch isolation)..."
MAIN_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo")
echo "MAIN flow response: ${MAIN_RESP}"

node --input-type=module <<EOF
const doc = ${MAIN_RESP};
const n3 = (doc.nodes || []).find((n) => n.id === "n3");
if (!n3) { console.error("ASSERTION FAILED: n3 not found on main"); process.exit(1); }
if (n3.params?.amount !== 100) {
  console.error(\`ASSERTION FAILED: branch edit leaked to main — expected n3.params.amount===100, got \${n3.params?.amount}\`);
  process.exit(1);
}
console.log("BRANCH ISOLATION ASSERTION PASSED: main n3.params.amount === 100");
EOF

echo "==> Cross-flow guard setup: PUT /api/flows/demo2 (creates demo2-main)..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_100}" \
  "http://localhost:${PORT}/api/flows/demo2"
echo ""

echo "==> PUT /api/flows/demo?branch=demo2-main — assert HTTP 400 (B-1 cross-flow guard)..."
CROSS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE_90}" \
  "http://localhost:${PORT}/api/flows/demo?branch=demo2-main")
echo "cross-flow PUT status: ${CROSS_STATUS}"

if [[ "${CROSS_STATUS}" -ne 400 ]]; then
  echo "ASSERTION FAILED: expected 400 for cross-flow ?branch=demo2-main, got ${CROSS_STATUS}"
  exit 1
fi
echo "CROSS-FLOW GUARD 400 ASSERTION PASSED"

echo "==> POST /api/flows/demo/rollback?branch=B {toCommitId:C_MAIN} — assert 200 round-trip..."
ROLLBACK_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"toCommitId\":\"${C_MAIN}\"}" \
  "http://localhost:${PORT}/api/flows/demo/rollback?branch=${B}")
echo "ROLLBACK response: ${ROLLBACK_RESP}"

node --input-type=module <<EOF
const d = ${ROLLBACK_RESP};
const errors = [];
if (!d.commit?.id) errors.push("rollback response has no commit.id");
const n3 = (d.doc?.nodes || []).find((n) => n.id === "n3");
if (!n3) {
  errors.push("rollback doc missing n3");
} else if (n3.params?.amount !== 100) {
  errors.push(\`rollback did not round-trip — expected n3.params.amount===100, got \${n3.params?.amount}\`);
}
if (errors.length > 0) { console.error("ASSERTION FAILED (rollback on branch B):", errors.join("; ")); process.exit(1); }
console.log("ROLLBACK ON BRANCH B ASSERTION PASSED: amount round-trips to 100");
EOF

echo "==> GET /api/flows/demo?branch=B — assert branch B live amount is 100 after rollback..."
BRANCH_AFTER_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo?branch=${B}")
echo "BRANCH AFTER response: ${BRANCH_AFTER_RESP}"

node --input-type=module <<EOF
const doc = ${BRANCH_AFTER_RESP};
const n3 = (doc.nodes || []).find((n) => n.id === "n3");
if (!n3) { console.error("ASSERTION FAILED: n3 not found on branch B"); process.exit(1); }
if (n3.params?.amount !== 100) {
  console.error(\`ASSERTION FAILED: expected branch B n3.params.amount===100 after rollback, got \${n3.params?.amount}\`);
  process.exit(1);
}
console.log("BRANCH B POST-ROLLBACK ASSERTION PASSED: n3.params.amount === 100");
EOF

echo "==> e2e-rung3b PASSED"
