#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-decole-d1-identity}"
EVENT_DB_NAME="${EVENT_DB_NAME:-decole-d1-event-store}"
IDENTITY_SQL="${ROOT_DIR}/config/d1/identity_links.sql"
EVENT_SQL="${ROOT_DIR}/config/d1/funnel_events.sql"
GA4_SQL="${ROOT_DIR}/config/d1/ga4_daily_metrics.sql"
META_SQL="${ROOT_DIR}/config/d1/meta_daily_metrics.sql"
WRANGLER_CWD="${ROOT_DIR}/workers/funnel-dispatcher"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [--identity-db <name>] [--event-db <name>]

Requires:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity-db)
      IDENTITY_DB_NAME="${2:-}"
      shift 2
      ;;
    --event-db)
      EVENT_DB_NAME="${2:-}"
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

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" >&2
  exit 1
fi

if [[ ! -f "$IDENTITY_SQL" || ! -f "$EVENT_SQL" || ! -f "$GA4_SQL" || ! -f "$META_SQL" ]]; then
  echo "SQL schema files not found" >&2
  exit 1
fi

cd "$WRANGLER_CWD"

echo "[d1] applying identity schema -> $IDENTITY_DB_NAME"
npx wrangler d1 execute "$IDENTITY_DB_NAME" --remote --file "$IDENTITY_SQL"

echo "[d1] applying event-store schema -> $EVENT_DB_NAME"
npx wrangler d1 execute "$EVENT_DB_NAME" --remote --file "$EVENT_SQL"

echo "[d1] applying ga4_daily_metrics schema -> $EVENT_DB_NAME"
npx wrangler d1 execute "$EVENT_DB_NAME" --remote --file "$GA4_SQL"

echo "[d1] applying meta_daily_metrics schema -> $EVENT_DB_NAME"
npx wrangler d1 execute "$EVENT_DB_NAME" --remote --file "$META_SQL"

echo "[ok] D1 schemas applied"
