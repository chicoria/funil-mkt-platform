#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local}"
HOTMART_INGRESS_URL="${HOTMART_INGRESS_URL:-https://api.decolesuacarreiraesg.com.br}"
HOTMART_PRODUCT_SLUG="${HOTMART_PRODUCT_SLUG:-decole-esg}"
HOTMART_OPERATION="${HOTMART_OPERATION:-purchase}"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0")

Optional env:
  ENV_FILE                 Defaults to <repo>/.env.local
  HOTMART_INGRESS_URL      Defaults to https://api.decolesuacarreiraesg.com.br
  HOTMART_PRODUCT_SLUG     Defaults to decole-esg
  HOTMART_OPERATION        Defaults to purchase

This smoke test reads HOTMART_WEBHOOK_TOKEN from ENV_FILE and sends a
synthetic HOTMART_TOKEN_PROBE event to production. The event has no handler
chain in the catalog, so a 202 response verifies auth without triggering
Brevo, n8n, GA4, or Meta side effects.
USAGE
}

read_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="$key" '
    $1 == key {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$file"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[fail] env file not found: $ENV_FILE" >&2
  exit 1
fi

HOTMART_WEBHOOK_TOKEN="$(read_env_value HOTMART_WEBHOOK_TOKEN "$ENV_FILE")"
if [[ -z "$HOTMART_WEBHOOK_TOKEN" ]]; then
  echo "[fail] HOTMART_WEBHOOK_TOKEN missing in $ENV_FILE" >&2
  exit 1
fi

EVENT_ID="hotmart-token-probe-$(date +%s)"
URL="${HOTMART_INGRESS_URL%/}/webhooks/v1/${HOTMART_PRODUCT_SLUG}/hotmart/${HOTMART_OPERATION}"
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

PAYLOAD=$(printf '{"event_id":"%s","event":"HOTMART_TOKEN_PROBE","buyer":{"email":"qa.token-probe@example.invalid"},"created_at":"%s"}' \
  "$EVENT_ID" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)")

STATUS=$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" \
  -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-hotmart-hottok: ${HOTMART_WEBHOOK_TOKEN}" \
  --data "$PAYLOAD")

if [[ "$STATUS" != "202" ]]; then
  echo "[fail] production Hotmart ingress rejected token status=$STATUS" >&2
  echo "[fail] url=$URL" >&2
  echo "[fail] response=$(cat "$RESPONSE_FILE")" >&2
  exit 1
fi

echo "[ok] production Hotmart ingress accepted HOTMART_WEBHOOK_TOKEN from $ENV_FILE"
echo "url=$URL"
echo "event_id=$EVENT_ID"
