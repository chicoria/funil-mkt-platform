#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOTMART_INGRESS_URL="${HOTMART_INGRESS_URL:-https://decole-api-hotmart-ingress.chicoria.workers.dev}"
FUNNEL_INGRESS_URL="${FUNNEL_INGRESS_URL:-https://decole-api-funnel-ingress.chicoria.workers.dev}"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-decole-d1-identity}"
EVENT_DB_NAME="${EVENT_DB_NAME:-decole-d1-event-store}"
WRANGLER_CWD="${ROOT_DIR}/backend/cloudflare/workers/funnel-dispatcher"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0")

Requires:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" >&2
  exit 1
fi

EVENT_ID_GL="e2e-auto-gl-$(date +%s)"
EVENT_ID_PA="e2e-auto-pa-$(date +%s)"
ANON_ID="anon-e2e-auto"

post_json() {
  local url="$1"
  local payload="$2"
  local status
  status=$(curl -sS -o /tmp/e2e_response.json -w "%{http_code}" -X POST "$url" -H "content-type: application/json" --data "$payload")
  if [[ "$status" != "202" ]]; then
    echo "[fail] POST $url status=$status body=$(cat /tmp/e2e_response.json)" >&2
    exit 1
  fi
  echo "[ok] POST $url -> 202"
}

d1_query_json() {
  local db_name="$1"
  local sql="$2"
  local raw
  raw="$(cd "$WRANGLER_CWD" && npx wrangler d1 execute "$db_name" --remote --command "$sql")"
  echo "$raw" | awk 'BEGIN{p=0} /^\[/{p=1} {if(p) print}'
}

echo "[step] generate_lead + dedupe"
post_json "$FUNNEL_INGRESS_URL/funnel/precheckout" "{\"event_id\":\"$EVENT_ID_GL\",\"event_type\":\"GENERATE_LEAD\",\"product_code\":\"DECOLE_ESG_MENTORIA\",\"email\":\"qa.auto@example.com\",\"anonymous_id\":\"$ANON_ID\",\"session_id\":\"sess-auto\"}"
post_json "$FUNNEL_INGRESS_URL/funnel/precheckout" "{\"event_id\":\"$EVENT_ID_GL\",\"event_type\":\"GENERATE_LEAD\",\"product_code\":\"DECOLE_ESG_MENTORIA\",\"email\":\"qa.auto@example.com\",\"anonymous_id\":\"$ANON_ID\",\"session_id\":\"sess-auto\"}"

echo "[step] purchase_approved"
post_json "$HOTMART_INGRESS_URL/webhooks/v1/planovoo/hotmart/purchase" "{\"event_id\":\"$EVENT_ID_PA\",\"event\":\"PURCHASE_APPROVED\",\"buyer\":{\"email\":\"qa.auto.purchase@example.com\"},\"transaction\":\"txn-$EVENT_ID_PA\",\"created_at\":\"2026-04-22T23:00:00Z\",\"currency\":\"BRL\",\"value\":297.00}"

echo "[step] aguardar processamento queue"
sleep 12

echo "[step] validar event_store"
EVENT_RESULT=$(d1_query_json "$EVENT_DB_NAME" "SELECT event_id, profile_id, anonymous_id, event_type FROM funnel_events WHERE event_id='${EVENT_ID_GL}'")
EVENT_FOUND=$(echo "$EVENT_RESULT" | jq -r '.[0].results[0].event_id // empty')
PROFILE_ID=$(echo "$EVENT_RESULT" | jq -r '.[0].results[0].profile_id // empty')
if [[ -z "$EVENT_FOUND" || -z "$PROFILE_ID" ]]; then
  echo "[fail] funnel_events missing row for $EVENT_ID_GL" >&2
  echo "$EVENT_RESULT" >&2
  exit 1
fi

echo "[step] validar identity_links"
IDENTITY_RESULT=$(d1_query_json "$IDENTITY_DB_NAME" "SELECT profile_id, anonymous_id FROM identity_links WHERE anonymous_id='${ANON_ID}' ORDER BY updated_at DESC LIMIT 1")
IDENTITY_PROFILE_ID=$(echo "$IDENTITY_RESULT" | jq -r '.[0].results[0].profile_id // empty')
if [[ -z "$IDENTITY_PROFILE_ID" ]]; then
  echo "[fail] identity_links missing anonymous_id ${ANON_ID}" >&2
  echo "$IDENTITY_RESULT" >&2
  exit 1
fi

if [[ "$IDENTITY_PROFILE_ID" != "$PROFILE_ID" ]]; then
  echo "[fail] profile mismatch event_store=$PROFILE_ID identity_links=$IDENTITY_PROFILE_ID" >&2
  exit 1
fi

echo "[ok] E2E staging passed"
echo "event_generate_lead=$EVENT_ID_GL"
echo "event_purchase_approved=$EVENT_ID_PA"
echo "profile_id=$PROFILE_ID"
