#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") --url <worker-url> [--expected 200]

Example:
  $(basename "$0") --url https://decole-api-hotmart-ingress.<subdomain>.workers.dev/health
USAGE
}

URL=""
EXPECTED="200"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      URL="${2:-}"
      shift 2
      ;;
    --expected)
      EXPECTED="${2:-200}"
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

if [[ -z "$URL" ]]; then
  echo "--url is required" >&2
  usage
  exit 1
fi

STATUS=$(curl -sS -o /tmp/worker-healthcheck.out -w "%{http_code}" "$URL")
BODY=$(cat /tmp/worker-healthcheck.out)

if [[ "$STATUS" != "$EXPECTED" ]]; then
  echo "[healthcheck] FAIL status=$STATUS expected=$EXPECTED body=${BODY:0:300}" >&2
  exit 1
fi

echo "[healthcheck] OK status=$STATUS body=${BODY:0:300}"
