#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/backend/cloudflare/config/cloudflare-greenfield.resources.json"
OUT_FILE="${ROOT_DIR}/backend/cloudflare/config/generated/cloudflare-greenfield.ids.json"
WRANGLER_CWD="${ROOT_DIR}/backend/cloudflare/workers/api-hotmart-ingress"
APPLY=0
SUFFIX=""

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [--apply] [--suffix <value>] [--out <file>]

Modes:
  default   Only prints the plan (no API calls).
  --apply   Creates missing resources in Cloudflare and writes IDs JSON.

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

wr() {
  (cd "$WRANGLER_CWD" && npx wrangler "$@")
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

mkdir -p "$(dirname "$OUT_FILE")"

ensure_queue() {
  local name="$1"
  local list_json
  list_json="$(wr queues list --json)"
  if echo "$list_json" | jq -e --arg n "$name" '.[] | select((.name // .queue_name // .queueName) == $n)' >/dev/null; then
    echo "[ok] queue exists: $name"
  else
    echo "[create] queue: $name"
    wr queues create "$name" >/dev/null
  fi
}

ensure_kv() {
  local title="$1"
  local list_json
  list_json="$(wr kv namespace list --json)"
  if echo "$list_json" | jq -e --arg n "$title" '.[] | select((.title // .name) == $n)' >/dev/null; then
    echo "[ok] kv exists: $title"
  else
    echo "[create] kv: $title"
    wr kv namespace create "$title" >/dev/null
  fi
}

ensure_d1() {
  local name="$1"
  local list_json
  list_json="$(wr d1 list --json)"
  if echo "$list_json" | jq -e --arg n "$name" '.[] | select((.name // .database_name) == $n)' >/dev/null; then
    echo "[ok] d1 exists: $name"
  else
    echo "[create] d1: $name"
    wr d1 create "$name" >/dev/null
  fi
}

ensure_queue "$QUEUE_MAIN"
ensure_queue "$QUEUE_DLQ"
ensure_kv "$KV_DEDUPE"
ensure_kv "$KV_IDENTITY"
ensure_d1 "$D1_IDENTITY"
ensure_d1 "$D1_EVENT_STORE"

KV_LIST_JSON="$(wr kv namespace list --json)"
D1_LIST_JSON="$(wr d1 list --json)"

KV_DEDUPE_ID="$(echo "$KV_LIST_JSON" | jq -r --arg n "$KV_DEDUPE" '.[] | select((.title // .name) == $n) | (.id // .namespace_id)' | head -n1)"
KV_IDENTITY_ID="$(echo "$KV_LIST_JSON" | jq -r --arg n "$KV_IDENTITY" '.[] | select((.title // .name) == $n) | (.id // .namespace_id)' | head -n1)"
D1_IDENTITY_ID="$(echo "$D1_LIST_JSON" | jq -r --arg n "$D1_IDENTITY" '.[] | select((.name // .database_name) == $n) | (.uuid // .id // .database_id)' | head -n1)"
D1_EVENT_STORE_ID="$(echo "$D1_LIST_JSON" | jq -r --arg n "$D1_EVENT_STORE" '.[] | select((.name // .database_name) == $n) | (.uuid // .id // .database_id)' | head -n1)"

if [[ -z "$KV_DEDUPE_ID" || -z "$KV_IDENTITY_ID" || -z "$D1_IDENTITY_ID" || -z "$D1_EVENT_STORE_ID" ]]; then
  echo "Failed to resolve one or more resource IDs" >&2
  exit 1
fi

jq -n \
  --arg queueMain "$QUEUE_MAIN" \
  --arg queueDlq "$QUEUE_DLQ" \
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
    queues: {
      funnel_main: { name: $queueMain },
      funnel_dlq: { name: $queueDlq }
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
