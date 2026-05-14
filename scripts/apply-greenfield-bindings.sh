#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDS_FILE="${ROOT_DIR}/config/generated/cloudflare-greenfield.ids.json"
WRANGLER_DISPATCHER="${ROOT_DIR}/workers/funnel-dispatcher/wrangler.toml"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [--ids <file>]

Reads generated IDs and applies them to:
- workers/funnel-dispatcher/wrangler.toml
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ids)
      IDS_FILE="${2:-}"
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

if [[ ! -f "$IDS_FILE" ]]; then
  echo "IDs file not found: $IDS_FILE" >&2
  exit 1
fi

if [[ ! -f "$WRANGLER_DISPATCHER" ]]; then
  echo "wrangler.toml not found: $WRANGLER_DISPATCHER" >&2
  exit 1
fi

DEDUP_ID="$(jq -r '.kv.DEDUPE_KV.id' "$IDS_FILE")"
IDENTITY_KV_ID="$(jq -r '.kv.IDENTITY_KV.id' "$IDS_FILE")"
IDENTITY_DB_ID="$(jq -r '.d1.IDENTITY_DB.id' "$IDS_FILE")"
EVENT_STORE_DB_ID="$(jq -r '.d1.EVENT_STORE_DB.id' "$IDS_FILE")"
D1_IDENTITY_NAME="$(jq -r '.d1.IDENTITY_DB.name' "$IDS_FILE")"
D1_EVENT_STORE_NAME="$(jq -r '.d1.EVENT_STORE_DB.name' "$IDS_FILE")"

if [[ -z "$DEDUP_ID" || -z "$IDENTITY_KV_ID" || -z "$IDENTITY_DB_ID" || -z "$EVENT_STORE_DB_ID" ]]; then
  echo "IDs file is missing required keys" >&2
  exit 1
fi

sed -i.bak "s/placeholder_dedupe_kv_id/$DEDUP_ID/g" "$WRANGLER_DISPATCHER"
sed -i.bak "s/placeholder_identity_kv_id/$IDENTITY_KV_ID/g" "$WRANGLER_DISPATCHER"
sed -i.bak "s/placeholder_identity_db_id/$IDENTITY_DB_ID/g" "$WRANGLER_DISPATCHER"
sed -i.bak "s/placeholder_event_store_db_id/$EVENT_STORE_DB_ID/g" "$WRANGLER_DISPATCHER"
sed -i.bak "s/decole-d1-identity/$D1_IDENTITY_NAME/g" "$WRANGLER_DISPATCHER"
sed -i.bak "s/decole-d1-event-store/$D1_EVENT_STORE_NAME/g" "$WRANGLER_DISPATCHER"

rm -f "${WRANGLER_DISPATCHER}.bak"

echo "[ok] updated $WRANGLER_DISPATCHER"
