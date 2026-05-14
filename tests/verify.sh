#!/usr/bin/env bash
# Comando único de verificação: testes unitários + E2E
# Usage:
#   ./verify.sh                  # unitários + E2E completo (--skip-sgtm)
#   ./verify.sh --unit-only      # só unitários (rápido, sem rede)
#   ./verify.sh --e2e-only       # só E2E
#   ./verify.sh --full           # unitários + E2E com sGTM replay
#   ./verify.sh --worker funnel-dispatcher  # unitários de 1 worker + E2E afectados
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CF_DIR="$ROOT_DIR"

UNIT_ONLY=0
E2E_ONLY=0
FULL=0
SPECIFIC_WORKER=""
META_TEST_EVENT_CODE=""

usage() {
  cat <<USAGE
Usage: $(basename "$0") [options]

Options:
  --unit-only              Run only unit tests (fast, no network)
  --e2e-only               Run only E2E scenarios
  --full                   Unit tests + E2E with sGTM replay
  --worker <name>          Unit test for specific worker + related E2E scenarios
  --meta-test-event-code   Meta test event code for E2E (implies sGTM)
  -h, --help               Show help

Examples:
  ./verify.sh                                     # default: unit + E2E --skip-sgtm
  ./verify.sh --unit-only                         # CI fast gate
  ./verify.sh --worker funnel-dispatcher          # after changing dispatcher
  ./verify.sh --full --meta-test-event-code TEST15651
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-only) UNIT_ONLY=1; shift ;;
    --e2e-only) E2E_ONLY=1; shift ;;
    --full) FULL=1; shift ;;
    --worker) SPECIFIC_WORKER="${2:-}"; shift 2 ;;
    --meta-test-event-code) META_TEST_EVENT_CODE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[error] unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  DECOLE — Verificação completa                           ║"
echo "╚══════════════════════════════════════════════════════════╝"

# ─── Mapeamento worker → cenários E2E afectados ─────────────────────────────
declare_worker_scenarios() {
  case "$1" in
    funnel-dispatcher)        echo "01,02,03,04,05,06,07,08" ;;
    api-funnel-ingress)       echo "01,07" ;;
    links-redirect)           echo "02" ;;
    api-hotmart-ingress)      echo "03,04,05,06" ;;
    shared)                   echo "01,02,03,04,05,06,07,08" ;;
    *)                        echo "01,02,03,04,05,06,07,08" ;;
  esac
}

UNIT_FAILED=0
E2E_FAILED=0

# ─── TESTES UNITÁRIOS ────────────────────────────────────────────────────────
run_unit_tests() {
  local target_workers=()

  if [[ -n "$SPECIFIC_WORKER" ]]; then
    target_workers=("$SPECIFIC_WORKER")
  else
    # Todos os workers com package.json + test script
    for w in "$CF_DIR"/workers/*/; do
      if [[ -f "$w/package.json" ]] && grep -q '"test"' "$w/package.json" 2>/dev/null; then
        target_workers+=("$(basename "$w")")
      fi
    done
    # Pacote shared
    if [[ -f "$CF_DIR/packages/shared/package.json" ]]; then
      target_workers+=("__shared__")
    fi
  fi

  echo ""
  echo "── Testes unitários ─────────────────────────────────────"
  local unit_pass=0
  local unit_fail=0

  for w in "${target_workers[@]}"; do
    local wdir
    if [[ "$w" == "__shared__" ]]; then
      wdir="$CF_DIR/packages/shared"
      wname="shared"
    else
      wdir="$CF_DIR/workers/$w"
      wname="$w"
    fi

    if [[ ! -d "$wdir" ]]; then
      echo "  ⚠  $wname — directório não encontrado, skip"
      continue
    fi

    printf "  %-35s " "$wname"
    if cd "$wdir" && npm test --silent 2>/dev/null; then
      echo "✓"
      ((unit_pass++)) || true
    else
      echo "✗"
      ((unit_fail++)) || true
      UNIT_FAILED=1
    fi
    cd "$SCRIPT_DIR"
  done

  echo ""
  echo "  Unitários: ${unit_pass} passed, ${unit_fail} failed"
}

# ─── E2E ─────────────────────────────────────────────────────────────────────
run_e2e() {
  echo ""
  echo "── Cenários E2E ─────────────────────────────────────────"

  local e2e_args=""
  local scenario_filter=""

  if [[ -n "$SPECIFIC_WORKER" ]]; then
    scenario_filter=$(declare_worker_scenarios "$SPECIFIC_WORKER")
    e2e_args="--scenario $scenario_filter"
  else
    e2e_args="--all"
  fi

  if [[ -n "$META_TEST_EVENT_CODE" ]]; then
    e2e_args="$e2e_args --meta-test-event-code $META_TEST_EVENT_CODE"
  elif [[ "$FULL" -eq 0 ]]; then
    e2e_args="$e2e_args --skip-sgtm"
  fi

  if bash "$SCRIPT_DIR/run-scenarios.sh" $e2e_args; then
    true
  else
    E2E_FAILED=1
  fi
}

# ─── EXECUÇÃO ────────────────────────────────────────────────────────────────
if [[ "$E2E_ONLY" -eq 0 ]]; then
  run_unit_tests
fi

if [[ "$UNIT_ONLY" -eq 0 ]]; then
  run_e2e
fi

# ─── SUMÁRIO FINAL ───────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  SUMÁRIO"
echo "══════════════════════════════════════════════════════════"
if [[ "$E2E_ONLY" -eq 0 ]]; then
  [[ "$UNIT_FAILED" -eq 0 ]] && echo "  ✓  Unitários" || echo "  ✗  Unitários"
fi
if [[ "$UNIT_ONLY" -eq 0 ]]; then
  [[ "$E2E_FAILED" -eq 0 ]] && echo "  ✓  E2E" || echo "  ✗  E2E"
fi
echo ""

[[ "$UNIT_FAILED" -eq 0 && "$E2E_FAILED" -eq 0 ]] && exit 0 || exit 1
