#!/usr/bin/env bash
# e2e-rung5.sh — Rung-5 end-to-end: exec_log immutability proof + viewer
#   Postgres → init-db → build → next start →
#   PUT demo fixture → POST /run (fires exec_log rows) → GET /exec-log (rows present) →
#   POST /rollback → GET /exec-log (rows UNCHANGED = honesty climax) →
#   run verify-immutability.ts (asserts REVOKE+trigger+live-rejection) → teardown

set -euo pipefail

PG_CONTAINER="pg-test-rung5"
PORT=3104
SERVER_PID=""

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
npx tsx scripts/init-db.ts

echo "==> Building Next.js app..."
npm run build

echo "==> Starting Next.js server on port ${PORT}..."
export MOCK_MODE=1
npx next start -p "${PORT}" &
SERVER_PID=$!

echo "==> Waiting for server to be ready..."
until curl -sf "http://localhost:${PORT}/" >/dev/null 2>&1; do
  sleep 0.5
done

# Simple fixture with webhook + stripe charge
FIXTURE='{
  "nodes": [
    {"id":"n1","type":"trigger.webhook","params":{},"isDraftSafe":true},
    {"id":"n2","type":"action.stripe.charge","params":{"amount":100,"currency":"usd"},"isDraftSafe":false}
  ],
  "edges": [
    {"id":"e1","fromNodeId":"n1","toNodeId":"n2"}
  ],
  "views": [
    {"nodeId":"n1","x":100,"y":200,"width":160,"height":80},
    {"nodeId":"n2","x":340,"y":200,"width":160,"height":80}
  ]
}'

echo "==> PUT /api/flows/demo..."
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${FIXTURE}" \
  "http://localhost:${PORT}/api/flows/demo"
echo ""

echo "==> POST /api/flows/demo/run → fires exec_log rows..."
RUN_RESP=$(curl -sf -X POST \
  "http://localhost:${PORT}/api/flows/demo/run")
echo "RUN response: ${RUN_RESP}"

# Verify run succeeded and returned exec entries
node --input-type=module <<EOF
const d = ${RUN_RESP};
if (!d.commitId) { console.error("ASSERTION FAILED: run has no commitId"); process.exit(1); }
if (!Array.isArray(d.entries) || d.entries.length === 0) {
  console.error("ASSERTION FAILED: run entries missing or empty");
  process.exit(1);
}
console.log("✓ run returned", d.entries.length, "exec entries");
EOF

echo "==> GET /api/flows/demo/exec-log (length ≥ 1)..."
EXEC_LOG_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/exec-log")
echo "EXEC-LOG response: ${EXEC_LOG_RESP}"

node --input-type=module <<EOF
const list = ${EXEC_LOG_RESP};
if (!Array.isArray(list)) { console.error("ASSERTION FAILED: exec-log is not array"); process.exit(1); }
if (list.length < 1) { console.error("ASSERTION FAILED: exec-log length < 1"); process.exit(1); }
console.log("✓ exec-log length ≥ 1:", list.length);
const lenBefore = list.length;
EOF

LEN_BEFORE=$(node --input-type=module <<EOF
const list = ${EXEC_LOG_RESP};
console.log(list.length);
EOF
)
echo "LEN_BEFORE = ${LEN_BEFORE}"

echo "==> POST /api/flows/demo/commit {authorNote:'pre-rollback'}..."
COMMIT_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"authorNote":"pre-rollback"}' \
  "http://localhost:${PORT}/api/flows/demo/commit")
echo "COMMIT response: ${COMMIT_RESP}"

COMMIT_ID=$(node --input-type=module <<EOF
const d = ${COMMIT_RESP};
if (!d.id) { console.error("ASSERTION FAILED: commit has no id"); process.exit(1); }
console.log(d.id);
EOF
)
echo "COMMIT_ID = ${COMMIT_ID}"

echo "==> POST /api/flows/demo/rollback {toCommitId:${COMMIT_ID}}..."
ROLLBACK_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"toCommitId\":\"${COMMIT_ID}\"}" \
  "http://localhost:${PORT}/api/flows/demo/rollback")
echo "ROLLBACK response: ${ROLLBACK_RESP}"

echo "==> GET /api/flows/demo/exec-log (length UNCHANGED = honesty climax)..."
EXEC_LOG_AFTER=$(curl -sf "http://localhost:${PORT}/api/flows/demo/exec-log")
echo "EXEC-LOG AFTER: ${EXEC_LOG_AFTER}"

node --input-type=module <<EOF
const before = ${LEN_BEFORE};
const after = ${EXEC_LOG_AFTER};
if (!Array.isArray(after)) { console.error("ASSERTION FAILED: after-rollback exec-log is not array"); process.exit(1); }
if (after.length !== before) {
  console.error(\`ASSERTION FAILED: exec-log length changed (before=\${before}, after=\${after.length})\`);
  process.exit(1);
}
console.log("✓ HONESTY CLIMAX: exec-log length unchanged after rollback (", after.length, ")");
EOF

echo "==> Running verify-immutability.ts (asserts REVOKE+trigger+live-rejection)..."
npx tsx scripts/verify-immutability.ts

echo "==> e2e-rung5 PASSED"
