#!/usr/bin/env bash
# e2e-rung4.sh — Rung-4 end-to-end: SidePanel + MOCK_MODE gate
#   Postgres → init-db → build (MOCK_MODE=1) → next start →
#   PUT webhook→stripe fixture → POST /run → GET /exec-log → assert mock charge

set -euo pipefail

PG_CONTAINER="pg-test-rung4"
PORT=3103
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
  -p 5433:5432 \
  postgres:16

unset DATABASE_URL
export DATABASE_URL="postgresql://app:secret@localhost:5433/flows"

echo "==> Waiting for Postgres to be ready..."
until docker exec "${PG_CONTAINER}" pg_isready -U app -d flows -q; do
  sleep 0.5
done

echo "==> Running db:init..."
npx tsx scripts/init-db.ts

echo "==> Building Next.js app (MOCK_MODE=1)..."
export MOCK_MODE=1
npm run build

echo "==> Starting Next.js server on port ${PORT} (MOCK_MODE=1)..."
export MOCK_MODE=1
npx next start -p "${PORT}" &
SERVER_PID=$!

echo "==> Waiting for server to be ready..."
until curl -sf "http://localhost:${PORT}/" >/dev/null 2>&1; do
  sleep 0.5
done

echo "==> PUT /api/flows/demo (webhook → stripe charge fixture)..."
PUT_BODY='{
  "nodes": [
    {"id":"n1","type":"trigger.webhook","params":{},"isDraftSafe":true},
    {"id":"n2","type":"action.stripe.charge","params":{"amount":250,"currency":"usd"},"credentialRef":"demo/stripe-test","isDraftSafe":false}
  ],
  "edges": [
    {"id":"e1","fromNodeId":"n1","toNodeId":"n2"}
  ],
  "views": [
    {"nodeId":"n1","x":100,"y":200,"width":160,"height":80},
    {"nodeId":"n2","x":340,"y":200,"width":160,"height":80}
  ]
}'

PUT_RESP=$(curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d "${PUT_BODY}" \
  "http://localhost:${PORT}/api/flows/demo")
echo "PUT response: ${PUT_RESP}"

echo "==> POST /api/flows/demo/run..."
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

echo "==> GET /api/flows/demo/exec-log..."
EXEC_LOG_RESP=$(curl -sf "http://localhost:${PORT}/api/flows/demo/exec-log")
echo "EXEC-LOG response: ${EXEC_LOG_RESP}"

echo "==> Asserting exec-log response..."
node --input-type=module <<EOF
const list = ${EXEC_LOG_RESP};
const errors = [];
if (!Array.isArray(list) || list.length < 1) {
  errors.push(\`Expected exec-log length >=1, got \${list?.length}\`);
}
const stripe = (list || []).find((e) => e.actionType === "action.stripe.charge");
if (!stripe) {
  errors.push("No exec-log row with actionType action.stripe.charge");
} else {
  if (stripe.response?.mock !== true) errors.push("exec-log stripe row response.mock !== true");
  if (typeof stripe.response?.chargeId !== "string" || !stripe.response.chargeId.startsWith("mock_ch_")) {
    errors.push(\`exec-log stripe chargeId not mock_ch_*: \${stripe.response?.chargeId}\`);
  }
}
if (errors.length > 0) {
  console.error("ASSERTION FAILED:", errors.join("; "));
  process.exit(1);
}
console.log("EXEC-LOG ASSERTIONS PASSED");
EOF

echo "==> e2e-rung4 PASSED"
