#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") --worker <name> [--dry-run]

Workers supported:
  - api-hotmart-ingress
  - api-funnel-ingress
  - funnel-dispatcher

Required env vars:
  - CLOUDFLARE_API_TOKEN
  - CLOUDFLARE_ACCOUNT_ID
USAGE
}

WORKER=""
DRY_RUN="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker)
      WORKER="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
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

if [[ -z "$WORKER" ]]; then
  echo "--worker is required" >&2
  usage
  exit 1
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" >&2
  exit 1
fi

case "$WORKER" in
  api-hotmart-ingress|api-funnel-ingress|funnel-dispatcher)
    WORKER_DIR="$ROOT_DIR/workers/$WORKER"
    ;;
  *)
    echo "Unsupported worker: $WORKER" >&2
    exit 1
    ;;
esac

if [[ ! -d "$WORKER_DIR" ]]; then
  echo "Worker directory not found: $WORKER_DIR" >&2
  exit 1
fi

echo "[deploy] worker=$WORKER dry_run=$DRY_RUN"
cd "$WORKER_DIR"

npm test
npm run typecheck

if [[ "$DRY_RUN" == "1" ]]; then
  npx wrangler deploy --dry-run
else
  npx wrangler deploy
fi
