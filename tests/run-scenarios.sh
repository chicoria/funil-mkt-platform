#!/usr/bin/env bash
# E2E scenario runner for DECOLE funnel
# Usage:
#   ./run-scenarios.sh --all
#   ./run-scenarios.sh --scenario 03
#   ./run-scenarios.sh --scenario 05,06
#   ./run-scenarios.sh --tag tracking
#   ./run-scenarios.sh --all --meta-test-event-code TEST19244
#   ./run-scenarios.sh --all --verify-destinations
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCENARIOS_DIR="$(dirname "${BASH_SOURCE[0]}")/scenarios"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.local"

ENV_FILE="$DEFAULT_ENV_FILE"
SELECTED_SCENARIOS=()
TAG_FILTER=""
META_TEST_EVENT_CODE=""
VERIFY_DESTINATIONS=0
SKIP_SGTM=0
OUTPUT_JSON="${OUTPUT_JSON:-}"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [options]

Options:
  --all                         Run all scenarios
  --scenario <n>[,<n>...]       Run specific scenario(s) by number (e.g. 03 or 03,05,06)
  --tag <tag>                   Run scenarios matching a tag (e.g. tracking, identity)
  --env-file <path>             Env file (default: .env.local)
  --meta-test-event-code <code> Override Meta test event code for sGTM scenarios
  --verify-destinations         Enable GA4 + Meta verification (opt-in)
  --skip-sgtm                   Skip sGTM replay steps
  --output-json <file>          Write full JSON results to file
  -h, --help                    Show help

Examples:
  ./run-scenarios.sh --all
  ./run-scenarios.sh --scenario 03 --meta-test-event-code TEST19244
  ./run-scenarios.sh --scenario 05,06
  ./run-scenarios.sh --tag tracking --skip-sgtm
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) SELECTED_SCENARIOS=(); shift ;;
    --scenario)
      IFS=',' read -ra NUMS <<< "${2:-}"
      for n in "${NUMS[@]}"; do SELECTED_SCENARIOS+=("$n"); done
      shift 2 ;;
    --tag) TAG_FILTER="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --meta-test-event-code) META_TEST_EVENT_CODE="${2:-}"; shift 2 ;;
    --verify-destinations) VERIFY_DESTINATIONS=1; shift ;;
    --skip-sgtm) SKIP_SGTM=1; shift ;;
    --output-json) OUTPUT_JSON="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[error] unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

# Load env file if present
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Fallback token
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_AGENTS_AI_TOKEN:-}" ]]; then
  export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_AGENTS_AI_TOKEN}"
fi

# Collect scenario files
all_files=()
for f in "$SCENARIOS_DIR"/[0-9]*.mjs; do
  [[ -f "$f" ]] && all_files+=("$f")
done

# Filter by scenario number or tag
selected_files=()
if [[ ${#SELECTED_SCENARIOS[@]} -gt 0 ]]; then
  for n in "${SELECTED_SCENARIOS[@]}"; do
    padded="$(printf '%02d' "$n" 2>/dev/null || echo "$n")"
    for f in "${all_files[@]}"; do
      basename_f="$(basename "$f")"
      if [[ "$basename_f" == "${padded}-"* || "$basename_f" == "${n}-"* ]]; then
        selected_files+=("$f")
      fi
    done
  done
elif [[ -n "$TAG_FILTER" ]]; then
  for f in "${all_files[@]}"; do
    # Read TAGS from the file (grep)
    if grep -q "\"${TAG_FILTER}\"" "$f" 2>/dev/null; then
      selected_files+=("$f")
    fi
  done
else
  selected_files=("${all_files[@]}")
fi

if [[ ${#selected_files[@]} -eq 0 ]]; then
  echo "[error] no matching scenario files found" >&2
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  DECOLE Funnel E2E Suite                                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "  Scenarios : ${#selected_files[@]}"
echo "  Env file  : $ENV_FILE"
echo "  sGTM      : $([ "$SKIP_SGTM" -eq 1 ] && echo 'skipped' || echo 'enabled')"
echo "  GA4/Meta  : $([ "$VERIFY_DESTINATIONS" -eq 1 ] && echo 'enabled' || echo 'opt-in (--verify-destinations)')"
[[ -n "$META_TEST_EVENT_CODE" ]] && echo "  Meta code : $META_TEST_EVENT_CODE"
echo ""

# Build node args string
extra_args=""
[[ -n "$META_TEST_EVENT_CODE" ]] && extra_args+=" --meta-test-event-code $META_TEST_EVENT_CODE"
[[ "$SKIP_SGTM" -eq 1 ]] && extra_args+=" --skip-sgtm"
[[ "$VERIFY_DESTINATIONS" -eq 1 ]] && extra_args+=" --verify-destinations"

# Run scenarios
all_results=()
passed=0
failed=0
skipped=0
total=${#selected_files[@]}

declare -A result_status
for f in "${selected_files[@]}"; do
  name="$(basename "$f" .mjs)"
  echo "──────────────────────────────────────────────────────────────"
  echo "  Running: $name"
  echo ""

  tmp_output="$(mktemp)"
  exit_code=0
  # Run scenario with env-file arg (scenarios read it themselves)
  node "$f" --env-file "$ENV_FILE" $extra_args 2>&1 | tee "$tmp_output" || exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    result_status["$name"]="pass"
    ((passed++)) || true
  else
    result_status["$name"]="fail"
    ((failed++)) || true
  fi

  # Collect JSON result (last JSON block in output)
  json_result="$(grep -o '{.*}' "$tmp_output" | tail -1 || true)"
  if [[ -n "$json_result" ]]; then
    all_results+=("$json_result")
  fi
  rm -f "$tmp_output"
done

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  RESULTS"
echo "══════════════════════════════════════════════════════════════"
for name in "${!result_status[@]}"; do
  status="${result_status[$name]}"
  if [[ "$status" == "pass" ]]; then
    echo "  ✓  $name"
  else
    echo "  ✗  $name"
  fi
done | sort

echo ""
echo "  Total: $total | Passed: $passed | Failed: $failed"
echo ""

# Write JSON output if requested
if [[ -n "$OUTPUT_JSON" ]]; then
  printf '[%s]' "$(IFS=','; echo "${all_results[*]}")" > "$OUTPUT_JSON"
  echo "  JSON: $OUTPUT_JSON"
fi

[[ $failed -eq 0 ]] && exit 0 || exit 1
