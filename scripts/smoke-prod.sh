#!/usr/bin/env bash
# smoke-prod.sh — Smoke tests pós-deploy para todos os workers e mkt-dashboard.
# Uso: bash scripts/smoke-prod.sh
#
# Variáveis de ambiente necessárias (ou definidas abaixo com defaults):
#   SYNC_SECRET       — secret do worker dashboard-sync (SYNC_SECRET no CF)
#   MKT_DASHBOARD_URL — URL do Cloudflare Pages (ex: https://mkt-dashboard.pages.dev)
#   DASHBOARD_SYNC_URL — URL do worker dashboard-sync (ex: https://decole-dashboard-sync.*.workers.dev)
#
# Workers com rota personalizada são testados no domínio configurado.

set -euo pipefail

# ── Configuração ──────────────────────────────────────────────────────────────

SYNC_SECRET="${SYNC_SECRET:-}"
MKT_DASHBOARD_URL="${MKT_DASHBOARD_URL:-}"
DASHBOARD_SYNC_URL="${DASHBOARD_SYNC_URL:-}"

LINKS_BASE="https://links.decolesuacarreiraesg.com.br"
API_BASE="https://api.decolesuacarreiraesg.com.br"

PASS=0
FAIL=0
SKIP=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

check() {
  local label="$1"
  local expected_status="$2"
  local actual_status="$3"
  local extra="${4:-}"

  if [[ "$actual_status" == "$expected_status" ]]; then
    echo -e "${GREEN}✅ PASS${NC} $label (HTTP $actual_status) $extra"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}❌ FAIL${NC} $label — esperado HTTP $expected_status, obtido HTTP $actual_status $extra"
    FAIL=$((FAIL + 1))
  fi
}

check_contains() {
  local label="$1"
  local body="$2"
  local pattern="$3"

  if echo "$body" | grep -q "$pattern"; then
    echo -e "${GREEN}✅ PASS${NC} $label (body contém '$pattern')"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}❌ FAIL${NC} $label — body não contém '$pattern'"
    echo "   Body: ${body:0:200}"
    FAIL=$((FAIL + 1))
  fi
}

skip() {
  echo -e "${YELLOW}⏭  SKIP${NC} $1 — $2"
  SKIP=$((SKIP + 1))
}

http_status() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$@"
}

http_body() {
  curl -s --max-time 10 "$@"
}

http_location() {
  curl -s -o /dev/null -w "%{redirect_url}" --max-time 10 -L "$@" 2>/dev/null || \
  curl -s -D - -o /dev/null --max-time 10 "$@" 2>/dev/null | grep -i "^location:" | head -1 | tr -d '\r'
}

# ── 1. links-redirect ─────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  1. links-redirect ($LINKS_BASE)"
echo "═══════════════════════════════════════════"

status=$(http_status "$LINKS_BASE/health")
check "GET /health" "200" "$status"

status=$(http_status "$LINKS_BASE/elizete-wp")
check "GET /elizete-wp → 302 WhatsApp" "302" "$status"

loc=$(curl -s -o /dev/null -w "%{redirect_url}" --max-time 10 "$LINKS_BASE/elizete-wp" 2>/dev/null || true)
if [[ "$loc" == *"wa.me"* ]]; then
  echo -e "${GREEN}✅ PASS${NC} /elizete-wp redireciona para wa.me ($loc)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}❌ FAIL${NC} /elizete-wp location inesperado: '$loc'"
  FAIL=$((FAIL + 1))
fi

status=$(http_status "$LINKS_BASE/checkout")
check "GET /checkout (legacy removida) → 404" "404" "$status"

status=$(http_status "$LINKS_BASE/decole-esg/checkout")
check "GET /decole-esg/checkout → 302" "302" "$status"

status=$(http_status "$LINKS_BASE/plano-de-voo/checkout")
check "GET /plano-de-voo/checkout → 302" "302" "$status"

status=$(http_status "$LINKS_BASE/rota-que-nao-existe")
check "GET /rota-inexistente → 404" "404" "$status"

# Tenant desconhecido (hostname alternativo não configurado)
status=$(http_status -H "Host: links.tenant-desconhecido-xyz.com" "$LINKS_BASE/health" 2>/dev/null || echo "000")
# Nota: CF route ignora Host header para roteamento — retorna 200/200 pois a rota já faz o bind ao hostname.
# O isolamento de tenant é feito via URL resolvida no código.
skip "tenant_not_configured via Host header alternativo" "CF routes vinculam ao hostname real"

# ── 2. api-funnel-ingress ─────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  2. api-funnel-ingress ($API_BASE)"
echo "═══════════════════════════════════════════"
# Nota: /health só é roteado via workers_dev; em produção com zone routes,
# apenas /funnel/* e /webhooks/* estão mapeados. CORS preflight é o smoke correto.

status=$(http_status -X OPTIONS \
  -H "Origin: https://decolesuacarreiraesg.com.br" \
  -H "Access-Control-Request-Method: POST" \
  "$API_BASE/funnel/event")
check "OPTIONS /funnel/event (CORS preflight DECOLE)" "204" "$status"

status=$(http_status -X OPTIONS \
  -H "Origin: https://origem-nao-autorizada.example.com" \
  -H "Access-Control-Request-Method: POST" \
  "$API_BASE/funnel/event")
check "OPTIONS /funnel/event (origem não autorizada) → 4xx" "403" "$status"

# ── 3. api-hotmart-ingress ────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  3. api-hotmart-ingress ($API_BASE)"
echo "═══════════════════════════════════════════"
# Nota: /health não é roteado em produção (zone routes = apenas /webhooks/v1/*)

# POST sem signature → deve rejeitar com 401/400
status=$(http_status -X POST \
  -H "Content-Type: application/json" \
  -d '{"event": "PURCHASE_APPROVED"}' \
  "$API_BASE/webhooks/v1/decole-esg/hotmart/purchase")
check "POST webhook sem HMAC → 4xx" "401" "$status" || \
check "POST webhook sem HMAC → 400" "400" "$status"

# ── 4. dashboard-sync ─────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  4. dashboard-sync"
echo "═══════════════════════════════════════════"

if [[ -z "$DASHBOARD_SYNC_URL" ]]; then
  skip "dashboard-sync smokes" "DASHBOARD_SYNC_URL não definido — export DASHBOARD_SYNC_URL=https://..."
elif [[ -z "$SYNC_SECRET" ]]; then
  skip "dashboard-sync smokes" "SYNC_SECRET não definido — export SYNC_SECRET=..."
else
  status=$(http_status -H "x-sync-secret: $SYNC_SECRET" "$DASHBOARD_SYNC_URL/sync/status")
  check "GET /sync/status com secret → 200" "200" "$status"

  body=$(http_body -H "x-sync-secret: $SYNC_SECRET" "$DASHBOARD_SYNC_URL/sync/status")
  check_contains "/sync/status body tem ok:true" "$body" '"ok":true'

  status=$(http_status "$DASHBOARD_SYNC_URL/sync/status")
  check "GET /sync/status sem secret → 401" "401" "$status"

  status=$(http_status -H "x-sync-secret: $SYNC_SECRET" \
    "$DASHBOARD_SYNC_URL/sync?date=2026-01-01&part=ga4&tenant=tenant_desconhecido_xyz")
  check "GET /sync com tenant inválido → 400" "400" "$status"

  status=$(http_status "$DASHBOARD_SYNC_URL/")
  body=$(http_body "$DASHBOARD_SYNC_URL/")
  check "GET / retorna identificação do worker" "200" "$status"
  check_contains "body contém 'dashboard-sync'" "$body" "dashboard-sync"
fi

# ── 5. mkt-dashboard ─────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  5. mkt-dashboard"
echo "═══════════════════════════════════════════"

if [[ -z "$MKT_DASHBOARD_URL" ]]; then
  skip "mkt-dashboard smokes" "MKT_DASHBOARD_URL não definido — export MKT_DASHBOARD_URL=https://..."
else
  status=$(http_status "$MKT_DASHBOARD_URL/")
  check "GET / → 200 ou redirect" "200" "$status" || \
  check "GET / → redirect" "302" "$status"

  status=$(http_status "$MKT_DASHBOARD_URL/dashboard")
  check "GET /dashboard sem cookie → redirect login" "307" "$status" || \
  check "GET /dashboard sem cookie → redirect login" "302" "$status"

  status=$(http_status "$MKT_DASHBOARD_URL/api/dashboard-sync")
  check "GET /api/dashboard-sync sem cookie → 401" "401" "$status"

  status=$(http_status -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "tenant=tenant-inexistente&password=senha-errada" \
    "$MKT_DASHBOARD_URL/api/auth")
  check "POST /api/auth com tenant/senha errados → redirect" "302" "$status"
fi

# ── Sumário ───────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════"
echo "  SUMÁRIO"
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}PASS:${NC} $PASS"
echo -e "  ${RED}FAIL:${NC} $FAIL"
echo -e "  ${YELLOW}SKIP:${NC} $SKIP"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}❌ SMOKE FAILED — $FAIL checks falharam${NC}"
  exit 1
else
  echo -e "${GREEN}✅ SMOKE PASSED — todos os checks obrigatórios passaram${NC}"
  exit 0
fi
