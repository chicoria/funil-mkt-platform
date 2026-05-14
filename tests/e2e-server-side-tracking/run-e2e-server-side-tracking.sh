#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.local"
DEFAULT_WRANGLER_CWD="${ROOT_DIR}/workers/funnel-dispatcher"
DEFAULT_REPLAY_SCRIPT="${ROOT_DIR}/scripts/replay-emit-tracking.mjs"
DEFAULT_GA4_VERIFY_SCRIPT="${ROOT_DIR}/tests/e2e-server-side-tracking/verify-ga4-realtime.mjs"
DEFAULT_META_VERIFY_SCRIPT="${ROOT_DIR}/tests/e2e-server-side-tracking/verify-sgtm-meta-delivery.mjs"
DEFAULT_META_STATS_VERIFY_SCRIPT="${ROOT_DIR}/tests/e2e-server-side-tracking/verify-meta-stats-delta.mjs"

HOTMART_INGRESS_URL_DEFAULT="https://api.decolesuacarreiraesg.com.br"
HOTMART_PRODUCT_PATH_DEFAULT="planovoo"
EVENT_DB_NAME_DEFAULT="decole-d1-event-store"
PRODUCT_CODE_DEFAULT="DECOLE_PLANOVOO"
EVENT_TYPE_DEFAULT="PURCHASE_APPROVED"
VALUE_DEFAULT="297"
CURRENCY_DEFAULT="BRL"
TIMEOUT_SECONDS_DEFAULT=120
POLL_SECONDS_DEFAULT=3

ENV_FILE="$DEFAULT_ENV_FILE"
WRANGLER_CWD="$DEFAULT_WRANGLER_CWD"
REPLAY_SCRIPT="$DEFAULT_REPLAY_SCRIPT"
GA4_VERIFY_SCRIPT="$DEFAULT_GA4_VERIFY_SCRIPT"
META_VERIFY_SCRIPT="$DEFAULT_META_VERIFY_SCRIPT"
META_STATS_VERIFY_SCRIPT="$DEFAULT_META_STATS_VERIFY_SCRIPT"
HOTMART_INGRESS_URL="$HOTMART_INGRESS_URL_DEFAULT"
HOTMART_PRODUCT_PATH="$HOTMART_PRODUCT_PATH_DEFAULT"
EVENT_DB_NAME="$EVENT_DB_NAME_DEFAULT"
PRODUCT_CODE="$PRODUCT_CODE_DEFAULT"
EVENT_TYPE="$EVENT_TYPE_DEFAULT"
VALUE="$VALUE_DEFAULT"
CURRENCY="$CURRENCY_DEFAULT"
TIMEOUT_SECONDS="$TIMEOUT_SECONDS_DEFAULT"
POLL_SECONDS="$POLL_SECONDS_DEFAULT"
EXISTING_EVENT_ID=""
STRICT_SGTM_LOGS=0
VERIFY_GA4=1
VERIFY_META=1
STRICT_DESTINATIONS=0
META_BASELINE_COUNT=""
META_TEST_EVENT_CODE_OVERRIDE=""

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [options]

Options:
  --event-id <id>              Usa evento existente no D1 (nao envia webhook)
  --env-file <path>            Arquivo env local (default: .env.local)
  --event-db <name>            D1 event store (default: ${EVENT_DB_NAME_DEFAULT})
  --product-code <code>        product_code para payload canario (default: ${PRODUCT_CODE_DEFAULT})
  --event-type <type>          Evento Hotmart enviado no canario (default: ${EVENT_TYPE_DEFAULT})
  --value <number>             value no payload canario (default: ${VALUE_DEFAULT})
  --currency <code>            currency no payload canario (default: ${CURRENCY_DEFAULT})
  --hotmart-url <url>          Base URL do ingress hotmart (default: ${HOTMART_INGRESS_URL_DEFAULT})
  --hotmart-product <path>     Path do produto no endpoint hotmart (default: ${HOTMART_PRODUCT_PATH_DEFAULT})
  --timeout-seconds <n>        Timeout de espera no D1 (default: ${TIMEOUT_SECONDS_DEFAULT})
  --poll-seconds <n>           Intervalo de polling no D1 (default: ${POLL_SECONDS_DEFAULT})
  --wrangler-cwd <path>        Diretorio para wrangler (default: workers/funnel-dispatcher)
  --replay-script <path>       Script replay-emit-tracking (default: scripts/replay-emit-tracking.mjs)
  --ga4-verify-script <path>   Script de validacao GA4 Realtime
  --meta-verify-script <path>  Script de validacao Meta via logs sGTM
  --meta-stats-script <path>   Script de validacao Meta via /stats
  --meta-test-event-code <code> Injeta test_event_code no replay para sGTM
  --no-verify-ga4              Nao valida GA4 no final
  --no-verify-meta             Nao valida Meta no final
  --strict-destinations        Falha se GA4 ou Meta nao puderem ser validados
  --strict-sgtm-logs           Falha se nao encontrar evidencias em Cloud Run logs (requer gcloud + vars)
  -h, --help                   Mostra ajuda

Environment:
  Requer: CLOUDFLARE_ACCOUNT_ID e um token Cloudflare:
    - CLOUDFLARE_API_TOKEN, ou
    - CLOUDFLARE_AGENTS_AI_TOKEN (fallback automatico)
  Opcional: HOTMART_WEBHOOK_TOKEN
  Opcional para logs sGTM:
    SGTM_GCP_PROJECT_ID, SGTM_CLOUD_RUN_SERVICE
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[fail] missing command: $1" >&2
    exit 1
  fi
}

required_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "[fail] missing env: ${key}" >&2
    exit 1
  fi
}

load_env_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$path"
    set +a
  fi
}

ensure_cloudflare_token() {
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_AGENTS_AI_TOKEN:-}" ]]; then
    export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_AGENTS_AI_TOKEN}"
    echo "[info] using CLOUDFLARE_AGENTS_AI_TOKEN as CLOUDFLARE_API_TOKEN"
  fi
}

d1_query_json() {
  local sql="$1"
  local raw
  raw="$(cd "$WRANGLER_CWD" && npx wrangler d1 execute "$EVENT_DB_NAME" --remote --command "$sql")"
  echo "$raw" | awk 'BEGIN{json=0} /^\[/{json=1} {if(json) print}'
}

wait_for_event_row() {
  local event_id="$1"
  local elapsed=0
  local sql result found
  sql="SELECT event_id, event_type, product_code, occurred_at FROM funnel_events WHERE event_id='${event_id}' LIMIT 1"

  while (( elapsed <= TIMEOUT_SECONDS )); do
    result="$(d1_query_json "$sql")"
    found="$(echo "$result" | jq -r '.[0].results[0].event_id // empty')"
    if [[ -n "$found" ]]; then
      echo "$result"
      return 0
    fi
    sleep "$POLL_SECONDS"
    elapsed=$((elapsed + POLL_SECONDS))
  done

  echo "$result"
  return 1
}

send_hotmart_canary() {
  local event_id="$1"
  local transaction_id="$2"
  local occurred_at="$3"
  local endpoint payload status
  local tmp_body
  tmp_body="$(mktemp)"
  endpoint="${HOTMART_INGRESS_URL}/webhooks/v1/${HOTMART_PRODUCT_PATH}/hotmart/purchase"

  payload="$(
    jq -nc \
      --arg event_id "$event_id" \
      --arg event_type "$EVENT_TYPE" \
      --arg transaction "$transaction_id" \
      --arg occurred_at "$occurred_at" \
      --arg currency "$CURRENCY" \
      --argjson value "$VALUE" \
      --arg product_code "$PRODUCT_CODE" \
      --arg email "qa.e2e.${event_id}@example.com" \
      '{
        event_id: $event_id,
        event: $event_type,
        transaction: $transaction,
        created_at: $occurred_at,
        currency: $currency,
        value: $value,
        product_code: $product_code,
        buyer: { email: $email }
      }'
  )"

  if [[ -n "${HOTMART_WEBHOOK_TOKEN:-}" ]]; then
    status="$(
      curl -sS -o "$tmp_body" -w "%{http_code}" \
        -X POST "$endpoint" \
        -H "content-type: application/json" \
        -H "x-hotmart-hottok: ${HOTMART_WEBHOOK_TOKEN}" \
        --data "$payload"
    )"
  else
    status="$(
      curl -sS -o "$tmp_body" -w "%{http_code}" \
        -X POST "$endpoint" \
        -H "content-type: application/json" \
        --data "$payload"
    )"
  fi

  if [[ "$status" != "202" ]]; then
    echo "[fail] webhook status=$status endpoint=$endpoint body=$(cat "$tmp_body")" >&2
    rm -f "$tmp_body"
    exit 1
  fi

  echo "[ok] webhook accepted (202) endpoint=$endpoint event_id=$event_id"
  rm -f "$tmp_body"
}

replay_event_apply() {
  local event_id="$1"
  local raw line planned sent
  local replay_args
  replay_args=(
    "$REPLAY_SCRIPT"
    --event-id "$event_id"
    --apply
    --db "$EVENT_DB_NAME"
    --env-file "$ENV_FILE"
    --wrangler-cwd "$WRANGLER_CWD"
  )
  if [[ -n "$META_TEST_EVENT_CODE_OVERRIDE" ]]; then
    replay_args+=(--meta-test-event-code "$META_TEST_EVENT_CODE_OVERRIDE")
  fi
  raw="$(node "${replay_args[@]}")"

  line="$(echo "$raw" | jq -Rr 'fromjson? | select(.event_id != null) | @json' | tail -n 1)"
  if [[ -z "$line" ]]; then
    echo "[fail] replay output without event row" >&2
    echo "$raw"
    exit 1
  fi

  planned="$(echo "$line" | jq -r '.planned.sgtm')"
  sent="$(echo "$line" | jq -r '.sent | index("sgtm")')"
  if [[ "$planned" != "true" ]]; then
    echo "[fail] replay planned.sgtm=false (tracking config ausente)" >&2
    echo "$line"
    exit 1
  fi
  if [[ "$sent" == "null" ]]; then
    echo "[fail] replay nao enviou para sgtm" >&2
    echo "$line"
    exit 1
  fi

  echo "$line"
}

check_sgtm_logs_optional() {
  local event_id="$1"
  if ! command -v gcloud >/dev/null 2>&1; then
    echo "[warn] gcloud nao instalado; pulando checagem opcional de logs sGTM"
    return 0
  fi
  if [[ -z "${SGTM_GCP_PROJECT_ID:-}" || -z "${SGTM_CLOUD_RUN_SERVICE:-}" ]]; then
    echo "[warn] SGTM_GCP_PROJECT_ID/SGTM_CLOUD_RUN_SERVICE ausentes; pulando checagem opcional de logs sGTM"
    return 0
  fi

  local filter logs_count
  filter="resource.type=cloud_run_revision AND resource.labels.service_name=\"${SGTM_CLOUD_RUN_SERVICE}\" AND textPayload:\"${event_id}\""
  logs_count="$(
    gcloud logging read "$filter" \
      --project "$SGTM_GCP_PROJECT_ID" \
      --freshness=15m \
      --limit=20 \
      --format='value(timestamp)' | wc -l | tr -d ' '
  )"

  if [[ "$logs_count" -gt 0 ]]; then
    echo "[ok] encontrou ${logs_count} log(s) no Cloud Run contendo event_id"
    return 0
  fi

  if [[ "$STRICT_SGTM_LOGS" -eq 1 ]]; then
    echo "[fail] nenhum log sGTM encontrado para event_id=${event_id}" >&2
    exit 1
  fi

  echo "[warn] nenhum log sGTM encontrado para event_id=${event_id} (nao estrito)"
}

event_type_to_ga4_name() {
  local event_type="$1"
  case "$event_type" in
    PURCHASE_APPROVED) echo "purchase" ;;
    GENERATE_LEAD|PRECHECKOUT_SUBMIT_SUCCESS) echo "generate_lead" ;;
    BEGIN_CHECKOUT|PURCHASE_OUT_OF_SHOPPING_CART) echo "begin_checkout" ;;
    *) echo "$(echo "$event_type" | tr '[:upper:]' '[:lower:]')" ;;
  esac
}

verify_ga4_destination() {
  local event_id="$1"
  local event_type="$2"
  if [[ "$VERIFY_GA4" -ne 1 ]]; then
    echo "[info] GA4 verification disabled"
    return 0
  fi
  if [[ ! -f "$GA4_VERIFY_SCRIPT" ]]; then
    echo "[warn] GA4 verify script not found: $GA4_VERIFY_SCRIPT"
    [[ "$STRICT_DESTINATIONS" -eq 1 ]] && return 1 || return 0
  fi
  if [[ -z "${GA4_PROPERTY_ID:-}" || -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "[warn] GA4_PROPERTY_ID/GOOGLE_APPLICATION_CREDENTIALS ausentes; pulando GA4"
    [[ "$STRICT_DESTINATIONS" -eq 1 ]] && return 1 || return 0
  fi

  local event_name
  event_name="$(event_type_to_ga4_name "$event_type")"
  local output
  if ! output="$(
    node "$GA4_VERIFY_SCRIPT" \
      --event-name "$event_name" \
      --event-id "$event_id" \
      --timeout-seconds 240 \
      --poll-seconds 12
  )"; then
    if [[ "$STRICT_DESTINATIONS" -eq 1 ]]; then
      echo "[fail] GA4 verification failed: $output" >&2
      return 1
    fi
    echo "[warn] GA4 verification could not be proven: $output"
    return 0
  fi
  echo "[ok] GA4 verification: $output"
  return 0
}

verify_meta_destination() {
  local event_id="$1"
  local product_code="$2"
  local event_type="$3"
  if [[ "$VERIFY_META" -ne 1 ]]; then
    echo "[info] Meta verification disabled"
    return 0
  fi

  local stats_output=""
  if [[ -f "$META_STATS_VERIFY_SCRIPT" && -n "$META_BASELINE_COUNT" ]]; then
    if stats_output="$(
      node "$META_STATS_VERIFY_SCRIPT" \
        --mode verify \
        --baseline-count "$META_BASELINE_COUNT" \
        --product-code "$product_code" \
        --event-type "$event_type" \
        --window-minutes 240 \
        --timeout-seconds 240 \
        --poll-seconds 12 \
        --env-file "$ENV_FILE"
    )"; then
      echo "[ok] Meta verification (stats delta): $stats_output"
      return 0
    fi
    echo "[warn] Meta stats delta not proven: $stats_output"
  fi

  if [[ ! -f "$META_VERIFY_SCRIPT" ]]; then
    echo "[warn] Meta log verify script not found: $META_VERIFY_SCRIPT"
    [[ "$STRICT_DESTINATIONS" -eq 1 ]] && return 1 || return 0
  fi
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "[warn] GOOGLE_APPLICATION_CREDENTIALS ausente; pulando fallback Meta logs"
    [[ "$STRICT_DESTINATIONS" -eq 1 ]] && return 1 || return 0
  fi

  local logs_output
  if ! logs_output="$(
    node "$META_VERIFY_SCRIPT" \
      --event-id "$event_id" \
      --lookback-minutes 25
  )"; then
    if [[ "$STRICT_DESTINATIONS" -eq 1 ]]; then
      echo "[fail] Meta verification failed (stats + logs): stats=${stats_output:-none}; logs=${logs_output}" >&2
      return 1
    fi
    echo "[warn] Meta verification could not be proven (stats + logs): stats=${stats_output:-none}; logs=${logs_output}"
    return 0
  fi
  echo "[ok] Meta verification (logs fallback): $logs_output"
  return 0
}

capture_meta_baseline() {
  local product_code="$1"
  local event_type="$2"
  if [[ "$VERIFY_META" -ne 1 ]]; then
    return 0
  fi
  if [[ ! -f "$META_STATS_VERIFY_SCRIPT" ]]; then
    echo "[warn] Meta stats script not found: $META_STATS_VERIFY_SCRIPT"
    return 0
  fi
  local baseline_output
  if ! baseline_output="$(
    node "$META_STATS_VERIFY_SCRIPT" \
      --mode count \
      --product-code "$product_code" \
      --event-type "$event_type" \
      --window-minutes 240 \
      --env-file "$ENV_FILE"
  )"; then
    echo "[warn] Meta baseline count unavailable: $baseline_output"
    return 0
  fi
  META_BASELINE_COUNT="$(echo "$baseline_output" | jq -r '.count // empty')"
  if [[ -n "$META_BASELINE_COUNT" ]]; then
    echo "[info] Meta baseline count captured: $META_BASELINE_COUNT"
  else
    echo "[warn] Meta baseline count parse failed: $baseline_output"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --event-id)
      EXISTING_EVENT_ID="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --event-db)
      EVENT_DB_NAME="${2:-}"
      shift 2
      ;;
    --product-code)
      PRODUCT_CODE="${2:-}"
      shift 2
      ;;
    --event-type)
      EVENT_TYPE="${2:-}"
      shift 2
      ;;
    --value)
      VALUE="${2:-}"
      shift 2
      ;;
    --currency)
      CURRENCY="${2:-}"
      shift 2
      ;;
    --hotmart-url)
      HOTMART_INGRESS_URL="${2:-}"
      shift 2
      ;;
    --hotmart-product)
      HOTMART_PRODUCT_PATH="${2:-}"
      shift 2
      ;;
    --timeout-seconds)
      TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    --poll-seconds)
      POLL_SECONDS="${2:-}"
      shift 2
      ;;
    --wrangler-cwd)
      WRANGLER_CWD="${2:-}"
      shift 2
      ;;
    --replay-script)
      REPLAY_SCRIPT="${2:-}"
      shift 2
      ;;
    --ga4-verify-script)
      GA4_VERIFY_SCRIPT="${2:-}"
      shift 2
      ;;
    --meta-verify-script)
      META_VERIFY_SCRIPT="${2:-}"
      shift 2
      ;;
    --meta-stats-script)
      META_STATS_VERIFY_SCRIPT="${2:-}"
      shift 2
      ;;
    --meta-test-event-code)
      META_TEST_EVENT_CODE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --no-verify-ga4)
      VERIFY_GA4=0
      shift
      ;;
    --no-verify-meta)
      VERIFY_META=0
      shift
      ;;
    --strict-destinations)
      STRICT_DESTINATIONS=1
      shift
      ;;
    --strict-sgtm-logs)
      STRICT_SGTM_LOGS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[fail] unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd jq
require_cmd node
require_cmd npx
require_cmd curl

load_env_file "$ENV_FILE"
ensure_cloudflare_token
required_env CLOUDFLARE_API_TOKEN
required_env CLOUDFLARE_ACCOUNT_ID

if [[ ! -f "$REPLAY_SCRIPT" ]]; then
  echo "[fail] replay script not found: $REPLAY_SCRIPT" >&2
  exit 1
fi

EVENT_ID="$EXISTING_EVENT_ID"
if [[ -z "$EVENT_ID" ]]; then
  EVENT_ID="e2e-ss-$(date +%s)-$RANDOM"
  TXN_ID="txn-${EVENT_ID}"
  OCCURRED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  echo "[step] enviar webhook canario"
  send_hotmart_canary "$EVENT_ID" "$TXN_ID" "$OCCURRED_AT"
fi

echo "[step] aguardar evento no D1 event_store"
EVENT_ROW="$(wait_for_event_row "$EVENT_ID")" || {
  echo "[fail] evento nao encontrado no D1: event_id=${EVENT_ID}" >&2
  echo "$EVENT_ROW" >&2
  exit 1
}
echo "[ok] evento encontrado no D1: event_id=${EVENT_ID}"
EVENT_TYPE_FROM_D1="$(echo "$EVENT_ROW" | jq -r '.[0].results[0].event_type // empty')"
PRODUCT_CODE_FROM_D1="$(echo "$EVENT_ROW" | jq -r '.[0].results[0].product_code // empty')"
if [[ -z "$EVENT_TYPE_FROM_D1" ]]; then
  echo "[fail] nao foi possivel extrair event_type do D1 para ${EVENT_ID}" >&2
  exit 1
fi
if [[ -z "$PRODUCT_CODE_FROM_D1" ]]; then
  echo "[fail] nao foi possivel extrair product_code do D1 para ${EVENT_ID}" >&2
  exit 1
fi

echo "[step] capturar baseline Meta API (/stats)"
capture_meta_baseline "$PRODUCT_CODE_FROM_D1" "$EVENT_TYPE_FROM_D1"

echo "[step] replay emit_tracking --apply"
REPLAY_ROW="$(replay_event_apply "$EVENT_ID")"
echo "[ok] replay apply enviado para sgtm event_id=$EVENT_ID"

echo "[step] checagem opcional de logs sGTM"
check_sgtm_logs_optional "$EVENT_ID"

echo "[step] validar destino final GA4"
verify_ga4_destination "$EVENT_ID" "$EVENT_TYPE_FROM_D1"

echo "[step] validar destino final Meta"
verify_meta_destination "$EVENT_ID" "$PRODUCT_CODE_FROM_D1" "$EVENT_TYPE_FROM_D1"

echo
echo "[done] e2e server-side base concluido"
echo "event_id=${EVENT_ID}"
echo "d1_event=$(echo "$EVENT_ROW" | jq -c '.[0].results[0]')"
echo "replay=$(echo "$REPLAY_ROW" | jq -c '.')"
echo
echo "Manual downstream checks (GA4 + Meta):"
echo "1) GA4 DebugView/Realtime: confirme event_name e parametros para event_id=${EVENT_ID}"
echo "2) Meta Test Events: confirme recebimento do mesmo event_id=${EVENT_ID}"
