#!/usr/bin/env bash
# e2e-rung1.sh — Rung-1 end-to-end: Postgres → init-db → build → next start →
#   PUT canonical fixture → POST /run → assert entries + exec_log + commit + branch head

set -euo pipefail

PG_CONTAINER="pg-test"
PORT=3100
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
  -p 5432:5432 \
  postgres:16

# B2: clear any inherited Aurora URL BEFORE pointing at the local Docker pg, so a
# Run never appends permanent rows to the production append-only exec_log.
unset DATABASE_URL
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

echo "==> PUT /api/flows/demo (canonical 4-node fixture)..."
PUT_BODY='{
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

PUT_RESP=$(curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${PUT_BODY}" \
  "http://localhost:${PORT}/api/flows/demo")
echo "PUT response: ${PUT_RESP}"

echo "==> POST /api/flows/demo/run (no body)..."
RUN_RESP=$(curl -sf -X POST "http://localhost:${PORT}/api/flows/demo/run")
echo "RUN response: ${RUN_RESP}"

echo "==> Asserting run response..."
node --input-type=module <<EOF
const data = ${RUN_RESP};
const errors = [];
if (!Array.isArray(data.entries) || data.entries.length < 1) {
  errors.push(\`Expected >=1 entry, got \${data.entries?.length}\`);
}
const stripe = (data.entries || []).find((e) => e.actionType === "action.stripe.charge");
if (!stripe) {
  errors.push("No entry with actionType action.stripe.charge");
} else {
  if (stripe.response?.mock !== true) errors.push("stripe entry response.mock !== true");
  if (typeof stripe.response?.chargeId !== "string" || !stripe.response.chargeId.startsWith("mock_ch_")) {
    errors.push(\`stripe chargeId not mock_ch_*: \${stripe.response?.chargeId}\`);
  }
}
if (typeof data.commitId !== "string") errors.push(\`commitId not a string: \${typeof data.commitId}\`);
if (errors.length > 0) {
  console.error("ASSERTION FAILED:", errors.join("; "));
  process.exit(1);
}
console.log("RUN RESPONSE ASSERTIONS PASSED");
EOF

echo "==> Asserting DB state..."
EXEC_COUNT=$(docker exec "${PG_CONTAINER}" psql -U app -d flows -tAc "select count(*) from exec_log")
COMMIT_COUNT=$(docker exec "${PG_CONTAINER}" psql -U app -d flows -tAc 'select count(*) from "commit"')
HEAD=$(docker exec "${PG_CONTAINER}" psql -U app -d flows -tAc "select head_commit_id from branch where id='demo-main'")

echo "exec_log count: ${EXEC_COUNT}"
echo "commit count: ${COMMIT_COUNT}"
echo "branch head: ${HEAD}"

if [[ "${EXEC_COUNT}" -lt 1 ]]; then
  echo "ASSERTION FAILED: expected exec_log count >=1, got ${EXEC_COUNT}"
  exit 1
fi
if [[ "${COMMIT_COUNT}" -ne 1 ]]; then
  echo "ASSERTION FAILED: expected commit count ==1, got ${COMMIT_COUNT}"
  exit 1
fi
if [[ -z "${HEAD}" ]]; then
  echo "ASSERTION FAILED: branch demo-main head_commit_id is null"
  exit 1
fi

echo "==> e2e-rung1 PASSED"
