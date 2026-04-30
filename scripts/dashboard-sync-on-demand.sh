#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.local}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

SYNC_BASE_URL="${SYNC_BASE_URL:-${DASHBOARD_SYNC_URL:-}}"
SYNC_SECRET="${SYNC_SECRET:-${ADMIN_SECRET:-}}"

usage() {
  cat <<'EOF'
Usage:
  bash backend/cloudflare/scripts/dashboard-sync-on-demand.sh run [--date YYYY-MM-DD] [--part all|ga4|meta]
  bash backend/cloudflare/scripts/dashboard-sync-on-demand.sh status

Env:
  SYNC_BASE_URL or DASHBOARD_SYNC_URL   Ex: https://decole-dashboard-sync.<account>.workers.dev
  SYNC_SECRET or ADMIN_SECRET           Secret used by dashboard-sync worker
  ENV_FILE                              Optional env file path (default: .env.local)
EOF
}

require_env() {
  if [[ -z "${SYNC_BASE_URL:-}" ]]; then
    echo "[error] missing SYNC_BASE_URL (or DASHBOARD_SYNC_URL)" >&2
    exit 1
  fi
  if [[ -z "${SYNC_SECRET:-}" ]]; then
    echo "[error] missing SYNC_SECRET (or ADMIN_SECRET)" >&2
    exit 1
  fi
}

cmd="${1:-}"
shift || true

case "$cmd" in
  run)
    require_env
    DATE_STR=""
    PART="all"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --date) DATE_STR="${2:-}"; shift 2 ;;
        --part) PART="${2:-}"; shift 2 ;;
        *) echo "[error] unknown arg: $1" >&2; usage; exit 1 ;;
      esac
    done

    BODY='{}'
    if [[ -n "$DATE_STR" ]]; then
      BODY="$(jq -cn --arg d "$DATE_STR" --arg p "$PART" '{date:$d, part:$p}')"
    else
      BODY="$(jq -cn --arg p "$PART" '{part:$p}')"
    fi

    curl -sS -X POST "${SYNC_BASE_URL%/}/sync/run" \
      -H "content-type: application/json" \
      -H "authorization: Bearer $SYNC_SECRET" \
      --data "$BODY" | jq .
    ;;
  status)
    require_env
    curl -sS "${SYNC_BASE_URL%/}/sync/status" \
      -H "authorization: Bearer $SYNC_SECRET" | jq .
    ;;
  *)
    usage
    exit 1
    ;;
esac

