#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/config/cloudflare-greenfield.resources.json"
OUT_FILE="${ROOT_DIR}/config/generated/cloudflare-greenfield.ids.json"
APPLY=0
SUFFIX=""

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [--apply] [--suffix <value>] [--out <file>]

Modes:
  default   Only prints the plan (no API calls).
  --apply   Creates missing resources via Cloudflare API and writes IDs JSON.

Required for --apply:
  - CLOUDFLARE_API_TOKEN
  - CLOUDFLARE_ACCOUNT_ID
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --suffix)
      SUFFIX="${2:-}"
      shift 2
      ;;
    --out)
      OUT_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Config not found: $CONFIG_FILE" >&2
  exit 1
fi

with_suffix() {
  local name="$1"
  printf "%s%s" "$name" "$SUFFIX"
}

QUEUE_MAIN="$(with_suffix "$(jq -r '.resources.queues.funnel_main' "$CONFIG_FILE")")"
QUEUE_DLQ="$(with_suffix "$(jq -r '.resources.queues.funnel_dlq' "$CONFIG_FILE")")"
KV_DEDUPE="$(with_suffix "$(jq -r '.resources.kv.dedupe' "$CONFIG_FILE")")"
KV_IDENTITY="$(with_suffix "$(jq -r '.resources.kv.identity' "$CONFIG_FILE")")"
D1_IDENTITY="$(with_suffix "$(jq -r '.resources.d1.identity' "$CONFIG_FILE")")"
D1_EVENT_STORE="$(with_suffix "$(jq -r '.resources.d1.event_store' "$CONFIG_FILE")")"

echo "[plan] queue.main=$QUEUE_MAIN"
echo "[plan] queue.dlq=$QUEUE_DLQ"
echo "[plan] kv.dedupe=$KV_DEDUPE"
echo "[plan] kv.identity=$KV_IDENTITY"
echo "[plan] d1.identity=$D1_IDENTITY"
echo "[plan] d1.event_store=$D1_EVENT_STORE"

if [[ "$APPLY" != "1" ]]; then
  echo "[plan] no changes applied (use --apply)"
  exit 0
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" >&2
  exit 1
fi

cf_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS -X "$method" "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

assert_success() {
  local response="$1"
  local op="$2"
  if ! echo "$response" | jq -e '.success == true' >/dev/null 2>&1; then
    echo "[error] $op failed" >&2
    echo "$response" | jq -c '{success, errors, messages}' >&2 || true
    exit 1
  fi
}

ensure_queue() {
  local name="$1"
  local list_response
  list_response="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/queues")"
  assert_success "$list_response" "queues list"

  if echo "$list_response" | jq -e --arg n "$name" '.result[]? | select((.queue_name // .name) == $n)' >/dev/null; then
    echo "[ok] queue exists: $name"
    return
  fi

  echo "[create] queue: $name"
  local create_response
  create_response="$(cf_api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/queues" "$(jq -cn --arg n "$name" '{queue_name:$n}')")"
  assert_success "$create_response" "queue create $name"
}

ensure_kv() {
  local title="$1"
  local list_response
  list_response="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100")"
  assert_success "$list_response" "kv list"

  if echo "$list_response" | jq -e --arg n "$title" '.result[]? | select((.title // .name) == $n)' >/dev/null; then
    echo "[ok] kv exists: $title"
    return
  fi

  echo "[create] kv: $title"
  local create_response
  create_response="$(cf_api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces" "$(jq -cn --arg n "$title" '{title:$n}')")"
  assert_success "$create_response" "kv create $title"
}

ensure_d1() {
  local name="$1"
  local list_response
  list_response="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database")"
  assert_success "$list_response" "d1 list"

  if echo "$list_response" | jq -e --arg n "$name" '.result[]? | select((.name // .database_name) == $n)' >/dev/null; then
    echo "[ok] d1 exists: $name"
    return
  fi

  echo "[create] d1: $name"
  local create_response
  create_response="$(cf_api POST "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database" "$(jq -cn --arg n "$name" '{name:$n}')")"
  assert_success "$create_response" "d1 create $name"
}

ensure_queue "$QUEUE_MAIN"
ensure_queue "$QUEUE_DLQ"
ensure_kv "$KV_DEDUPE"
ensure_kv "$KV_IDENTITY"
ensure_d1 "$D1_IDENTITY"
ensure_d1 "$D1_EVENT_STORE"

QUEUE_LIST_RESPONSE="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/queues")"
KV_LIST_RESPONSE="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100")"
D1_LIST_RESPONSE="$(cf_api GET "/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database")"

assert_success "$QUEUE_LIST_RESPONSE" "queues list"
assert_success "$KV_LIST_RESPONSE" "kv list"
assert_success "$D1_LIST_RESPONSE" "d1 list"

QUEUE_MAIN_ID="$(echo "$QUEUE_LIST_RESPONSE" | jq -r --arg n "$QUEUE_MAIN" '.result[]? | select((.queue_name // .name) == $n) | (.queue_id // .id // .uuid)' | head -n1)"
QUEUE_DLQ_ID="$(echo "$QUEUE_LIST_RESPONSE" | jq -r --arg n "$QUEUE_DLQ" '.result[]? | select((.queue_name // .name) == $n) | (.queue_id // .id // .uuid)' | head -n1)"
KV_DEDUPE_ID="$(echo "$KV_LIST_RESPONSE" | jq -r --arg n "$KV_DEDUPE" '.result[]? | select((.title // .name) == $n) | (.id // .namespace_id)' | head -n1)"
KV_IDENTITY_ID="$(echo "$KV_LIST_RESPONSE" | jq -r --arg n "$KV_IDENTITY" '.result[]? | select((.title // .name) == $n) | (.id // .namespace_id)' | head -n1)"
D1_IDENTITY_ID="$(echo "$D1_LIST_RESPONSE" | jq -r --arg n "$D1_IDENTITY" '.result[]? | select((.name // .database_name) == $n) | (.uuid // .id // .database_id)' | head -n1)"
D1_EVENT_STORE_ID="$(echo "$D1_LIST_RESPONSE" | jq -r --arg n "$D1_EVENT_STORE" '.result[]? | select((.name // .database_name) == $n) | (.uuid // .id // .database_id)' | head -n1)"

if [[ -z "$QUEUE_MAIN_ID" || -z "$QUEUE_DLQ_ID" || -z "$KV_DEDUPE_ID" || -z "$KV_IDENTITY_ID" || -z "$D1_IDENTITY_ID" || -z "$D1_EVENT_STORE_ID" ]]; then
  echo "Failed to resolve one or more resource IDs" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

jq -n \
  --arg queueMain "$QUEUE_MAIN" \
  --arg queueMainId "$QUEUE_MAIN_ID" \
  --arg queueDlq "$QUEUE_DLQ" \
  --arg queueDlqId "$QUEUE_DLQ_ID" \
  --arg kvDedupe "$KV_DEDUPE" \
  --arg kvDedupeId "$KV_DEDUPE_ID" \
  --arg kvIdentity "$KV_IDENTITY" \
  --arg kvIdentityId "$KV_IDENTITY_ID" \
  --arg d1Identity "$D1_IDENTITY" \
  --arg d1IdentityId "$D1_IDENTITY_ID" \
  --arg d1EventStore "$D1_EVENT_STORE" \
  --arg d1EventStoreId "$D1_EVENT_STORE_ID" \
  '{
    generated_at: (now | todateiso8601),
    account_id: "masked",
    queues: {
      funnel_main: { name: $queueMain, id: $queueMainId },
      funnel_dlq: { name: $queueDlq, id: $queueDlqId }
    },
    kv: {
      DEDUPE_KV: { title: $kvDedupe, id: $kvDedupeId },
      IDENTITY_KV: { title: $kvIdentity, id: $kvIdentityId }
    },
    d1: {
      IDENTITY_DB: { name: $d1Identity, id: $d1IdentityId },
      EVENT_STORE_DB: { name: $d1EventStore, id: $d1EventStoreId }
    }
  }' > "$OUT_FILE"

echo "[ok] wrote IDs to: $OUT_FILE"
