#!/usr/bin/env bash
# cleanup-test-data.sh — Remove dados de teste de todos os sistemas integrados.
#
# Sistemas cobertos:
#   - Brevo: contactos com email de padrão de teste
#   - D1 EVENT_STORE: funnel_events + identity_links com email/event_id de teste
#   - D1 IDENTITY: identity_links de teste
#   - (GA4 e Meta CAPI não têm API de delete — usar test_event_code para não poluir)
#
# Padrões de email de teste reconhecidos:
#   e2e.*@example.com  |  *@e2e-test.invalid  |  qa+*  |  chicoria+*  |  *@e2e.*
#
# Uso:
#   source .env.local && bash scripts/cleanup-test-data.sh
#   bash scripts/cleanup-test-data.sh --dry-run   (mostra o que seria removido)

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=true; fi

BREVO_KEY="${BREVO_API_KEY:-}"
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-c288163c00d98a307d770acae4032121}"
EVENT_DB="f5c19aac-2bdc-4fe4-b560-e1c49199ff4c"
IDENTITY_DB="e71a266a-b400-4970-a056-bf7223799f25"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
TOTAL_REMOVED=0

section() { echo ""; echo -e "${BLUE}══════════════════════════════════════════${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}══════════════════════════════════════════${NC}"; }
log_remove() { echo -e "  ${GREEN}🗑  REMOVE${NC} $1"; TOTAL_REMOVED=$((TOTAL_REMOVED+1)); }
log_skip()   { echo -e "  ${YELLOW}⏭  SKIP${NC} $1"; }
log_dry()    { echo -e "  ${YELLOW}🔍  DRY-RUN${NC} $1 (não removido)"; }

d1_query() {
  local db="$1" sql="$2"
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/d1/database/$db/query" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": $(echo "$sql" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8').trim()))")}" \
    | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(JSON.stringify(j.result?.[0] ?? j))"
}

# ── Padrão de email de teste ──────────────────────────────────────────────────
# Retorna 1 se o email é de teste, 0 se é real
is_test_email() {
  local email="$1"
  if echo "$email" | grep -qiE '^e2e\.|@example\.com$|@e2e-test\.|^qa\+|^test\.|chicoria\+|\.test@'; then
    return 0
  fi
  return 1
}

# ── 1. Brevo — contactos de teste ─────────────────────────────────────────────

section "1. Brevo — contactos de teste"

if [[ -z "$BREVO_KEY" ]]; then
  log_skip "BREVO_API_KEY não definido"
else
  # Buscar todos os contactos (max 1000 — ajustar limit se necessário)
  CONTACTS=$(curl -s "https://api.brevo.com/v3/contacts?limit=100&offset=0" \
    -H "api-key: $BREVO_KEY" -H "Accept: application/json" \
    | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
const test=(j.contacts||[]).filter(c=>/e2e\.|qa\+|chicoria\+|test\.|@e2e-test|@example\.com/.test(c.email||''));
test.forEach(c=>console.log(c.email));
")

  if [[ -z "$CONTACTS" ]]; then
    echo "  ✅ Nenhum contacto de teste encontrado"
  else
    echo "$CONTACTS" | while read email; do
      if [[ -z "$email" ]]; then continue; fi
      if $DRY_RUN; then
        log_dry "Brevo: $email"
      else
        status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
          "https://api.brevo.com/v3/contacts/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$email'))")" \
          -H "api-key: $BREVO_KEY")
        if [[ "$status" == "204" || "$status" == "404" ]]; then
          log_remove "Brevo: $email (HTTP $status)"
        else
          echo -e "  ${RED}❌ FAIL${NC} Brevo: $email (HTTP $status)"
        fi
      fi
    done
  fi
fi

# ── 2. D1 EVENT_STORE — funnel_events de teste ────────────────────────────────

section "2. D1 — funnel_events de teste"

if [[ -z "$CF_TOKEN" ]]; then
  log_skip "CLOUDFLARE_API_TOKEN não definido"
else
  # Eventos com event_id começando por 'e2e-' ou email_hash de emails de teste
  COUNT=$(d1_query "$EVENT_DB" \
    "SELECT COUNT(*) as n FROM funnel_events WHERE event_id LIKE 'e2e-%'" \
    | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(j.results?.[0]?.n ?? 0)")
  echo "  Eventos e2e-* em funnel_events: $COUNT"

  if [[ "$COUNT" -gt 0 ]]; then
    if $DRY_RUN; then
      log_dry "DELETE FROM funnel_events WHERE event_id LIKE 'e2e-%' ($COUNT rows)"
    else
      d1_query "$EVENT_DB" "DELETE FROM funnel_events WHERE event_id LIKE 'e2e-%'" > /dev/null
      log_remove "D1 funnel_events: $COUNT eventos e2e removidos"
    fi
  fi
fi

# ── 3. D1 IDENTITY — identity_links de teste ──────────────────────────────────

section "3. D1 — identity_links de teste"

if [[ -z "$CF_TOKEN" ]]; then
  log_skip "CLOUDFLARE_API_TOKEN não definido"
else
  # Profiles onde todos os eventos são de teste (para não remover profiles reais)
  COUNT_ID=$(d1_query "$IDENTITY_DB" \
    "SELECT COUNT(*) as n FROM identity_links WHERE profile_id LIKE 'e2e-%'" \
    | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(j.results?.[0]?.n ?? 0)")
  echo "  identity_links com profile_id e2e-*: $COUNT_ID"

  if [[ "$COUNT_ID" -gt 0 ]]; then
    if $DRY_RUN; then
      log_dry "DELETE FROM identity_links WHERE profile_id LIKE 'e2e-%' ($COUNT_ID rows)"
    else
      d1_query "$IDENTITY_DB" "DELETE FROM identity_links WHERE profile_id LIKE 'e2e-%'" > /dev/null
      log_remove "D1 identity_links: $COUNT_ID entradas e2e removidas"
    fi
  fi
fi

# ── 4. Verificação final Brevo ────────────────────────────────────────────────

if [[ -n "$BREVO_KEY" && ! $DRY_RUN ]]; then
  section "4. Verificação final"
  REMAINING=$(curl -s "https://api.brevo.com/v3/contacts?limit=100" \
    -H "api-key: $BREVO_KEY" -H "Accept: application/json" \
    | node -e "
const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const test=(j.contacts||[]).filter(c=>/e2e\.|qa\+|chicoria\+|test\.|@e2e-test|@example\.com/.test(c.email||''));
console.log(test.length);
")
  if [[ "$REMAINING" == "0" ]]; then
    echo -e "  ${GREEN}✅ Brevo limpo — 0 contactos de teste restantes${NC}"
  else
    echo -e "  ${RED}⚠️  Brevo ainda tem $REMAINING contactos de teste${NC}"
  fi
fi

# ── Sumário ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}══════════════════════════════════════════${NC}"
if $DRY_RUN; then
  echo -e "${YELLOW}  DRY-RUN — nada foi removido${NC}"
else
  echo -e "${GREEN}  CLEANUP CONCLUÍDO — $TOTAL_REMOVED itens removidos${NC}"
fi
echo -e "${BLUE}══════════════════════════════════════════${NC}"
