#!/usr/bin/env bash
# remove-contact.sh — Remove todos os dados de um contacto por email.
# ⚠ IRREVERSÍVEL — use --dry-run primeiro para confirmar o que vai ser apagado.
#
# Uso:
#   source .env.local && bash scripts/remove-contact.sh email@exemplo.com --dry-run
#   source .env.local && bash scripts/remove-contact.sh email@exemplo.com
#
# Sistemas cobertos:
#   1. Brevo — contacto e todos os atributos
#   2. D1 IDENTITY — todas as linhas de identity_links do profile
#   3. D1 EVENT_STORE — todos os eventos de funnel_events do profile

set -euo pipefail

EMAIL="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]] && DRY_RUN=true
[[ "$EMAIL" == "--dry-run" ]] && EMAIL="${2:-}"

if [[ -z "$EMAIL" ]]; then
  echo "Uso: bash scripts/remove-contact.sh <email> [--dry-run]"
  echo "Exemplo: bash scripts/remove-contact.sh chicoria@gmail.com --dry-run"
  exit 1
fi

[[ -f ".env.local" ]] && { set -a; source .env.local; set +a; }

BREVO_KEY="${BREVO_API_KEY:-}"
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-c288163c00d98a307d770acae4032121}"
EVENT_DB="f5c19aac-2bdc-4fe4-b560-e1c49199ff4c"
IDENTITY_DB="e71a266a-b400-4970-a056-bf7223799f25"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

section() { echo ""; echo -e "${BLUE}${BOLD}══════════════════════════════════════════${NC}"; echo -e "${BLUE}${BOLD}  $1${NC}"; echo -e "${BLUE}${BOLD}══════════════════════════════════════════${NC}"; }
ok()      { echo -e "  ${GREEN}✓${NC}  $1"; }
dry()     { echo -e "  ${YELLOW}◉  [DRY-RUN]${NC} $1"; }
skip()    { echo -e "  ${YELLOW}⏭${NC}  $1"; }
fail()    { echo -e "  ${RED}✘${NC}  $1"; }

REMOVED=0

d1_exec() {
  local db="$1" sql="$2"
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/d1/database/$db/query" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": $(echo "$sql" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8').trim()))")}" \
    | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(JSON.stringify(j.result?.[0] ?? j))"
}

d1_query() {
  local db="$1" sql="$2"
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/d1/database/$db/query" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": $(echo "$sql" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8').trim()))")}" \
    | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(JSON.stringify(j.result?.[0]?.results ?? []))"
}

# ── Cabeçalho ─────────────────────────────────────────────────────────────────

EMAIL_LOWER=$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
EMAIL_HASH=$(echo -n "$EMAIL_LOWER" | shasum -a 256 | cut -d' ' -f1)

echo ""
echo -e "${BOLD}Email a remover:${NC} $EMAIL_LOWER"
echo -e "${BOLD}SHA-256 hash:${NC}    $EMAIL_HASH"
if $DRY_RUN; then
  echo -e "\n${YELLOW}${BOLD}⚠  MODO DRY-RUN — nada será apagado${NC}\n"
else
  echo -e "\n${RED}${BOLD}⚠  REMOÇÃO PERMANENTE — dados serão apagados de todos os sistemas${NC}\n"
  read -r -p "Confirma? (escreve 'sim' para continuar): " CONFIRM
  if [[ "$CONFIRM" != "sim" ]]; then
    echo "Cancelado."
    exit 0
  fi
fi

# ── 1. Brevo ─────────────────────────────────────────────────────────────────

section "1. Brevo"

if [[ -z "$BREVO_KEY" ]]; then
  skip "BREVO_API_KEY não definido"
else
  ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$EMAIL_LOWER'))")
  EXISTS=$(curl -s "https://api.brevo.com/v3/contacts/$ENCODED" \
    -H "api-key: $BREVO_KEY" -H "Accept: application/json")

  if echo "$EXISTS" | grep -q '"code":"document_not_found"'; then
    skip "Contacto não encontrado no Brevo"
  elif echo "$EXISTS" | grep -q '"email"'; then
    BREVO_ID=$(echo "$EXISTS" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).id)")
    if $DRY_RUN; then
      dry "DELETE contacto Brevo id=$BREVO_ID email=$EMAIL_LOWER"
    else
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
        "https://api.brevo.com/v3/contacts/$ENCODED" \
        -H "api-key: $BREVO_KEY")
      if [[ "$STATUS" == "204" ]]; then
        ok "Contacto Brevo removido (id=$BREVO_ID, HTTP 204)"; REMOVED=$((REMOVED+1))
      else
        fail "Brevo DELETE retornou HTTP $STATUS"
      fi
    fi
  else
    fail "Erro ao consultar Brevo: $(echo "$EXISTS" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(j.message||j.code||'?')")"
  fi
fi

# ── 2. D1 IDENTITY — resolver profile_ids ────────────────────────────────────

section "2. D1 Identity"

if [[ -z "$CF_TOKEN" ]]; then
  skip "CLOUDFLARE_API_TOKEN não definido"
else
  IDENTITY_ROWS=$(d1_query "$IDENTITY_DB" \
    "SELECT profile_id, tenant_id FROM identity_links WHERE email_hash = '$EMAIL_HASH'")

  PROFILE_COUNT=$(echo "$IDENTITY_ROWS" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length)")

  if [[ "$PROFILE_COUNT" == "0" ]]; then
    skip "email_hash não encontrado em identity_links"
    PROFILE_IDS=""
  else
    PROFILE_IDS=$(echo "$IDENTITY_ROWS" | node -e "
const rows=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const ids=[...new Set(rows.map(r=>r.profile_id))];
console.log(ids.map(id=>\"'\"+ id +\"'\").join(','));
")

    # Verificar se o profile tem outros emails ligados (shared profile — risco de remover dados de terceiros)
    OTHER_EMAILS=$(d1_query "$IDENTITY_DB" \
      "SELECT email_hash FROM identity_links WHERE profile_id IN ($PROFILE_IDS) AND email_hash IS NOT NULL AND email_hash != '$EMAIL_HASH'")
    OTHER_EMAIL_COUNT=$(echo "$OTHER_EMAILS" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length)")

    if [[ "$OTHER_EMAIL_COUNT" -gt 0 ]]; then
      echo -e "  ${YELLOW}⚠  Profile partilhado com $OTHER_EMAIL_COUNT outro(s) email(s) — remoção cirúrgica${NC}"
      echo -e "  ${YELLOW}   Apenas o link deste email será removido (não todos os eventos do profile)${NC}"

      if $DRY_RUN; then
        dry "DELETE 1 linha de identity_links WHERE email_hash = '$EMAIL_HASH'"
      else
        d1_exec "$IDENTITY_DB" "DELETE FROM identity_links WHERE email_hash = '$EMAIL_HASH'" > /dev/null
        ok "Link identity_links removido apenas para email_hash específico"; REMOVED=$((REMOVED+1))
      fi
      PROFILE_IDS=""  # Limpar para que eventos não sejam apagados por profile (cirúrgico)
    else
      # Profile exclusivo deste email — apagar tudo do profile
      ALL_LINKS=$(d1_query "$IDENTITY_DB" \
        "SELECT COUNT(*) as n FROM identity_links WHERE profile_id IN ($PROFILE_IDS)")
      LINK_COUNT=$(echo "$ALL_LINKS" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0]?.n ?? 0)")

      if $DRY_RUN; then
        dry "DELETE $LINK_COUNT linhas de identity_links (profile exclusivo)"
      else
        d1_exec "$IDENTITY_DB" "DELETE FROM identity_links WHERE profile_id IN ($PROFILE_IDS)" > /dev/null
        ok "$LINK_COUNT linhas removidas de identity_links"; REMOVED=$((REMOVED+LINK_COUNT))
      fi
    fi
  fi
fi

# ── 3. D1 EVENT_STORE — funnel_events ────────────────────────────────────────

section "3. D1 Event Store — funnel_events"

if [[ -z "$CF_TOKEN" ]]; then
  skip "CLOUDFLARE_API_TOKEN não definido"
elif [[ -z "${PROFILE_IDS:-}" ]]; then
  # Mesmo sem profile, tenta apagar por email_hash directamente
  COUNT_BY_HASH=$(d1_query "$EVENT_DB" \
    "SELECT COUNT(*) as n FROM funnel_events WHERE email_hash = '$EMAIL_HASH'" \
    | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0]?.n ?? 0)")
  if [[ "$COUNT_BY_HASH" -gt 0 ]]; then
    if $DRY_RUN; then
      dry "DELETE $COUNT_BY_HASH eventos por email_hash (sem profile_id)"
    else
      d1_exec "$EVENT_DB" "DELETE FROM funnel_events WHERE email_hash = '$EMAIL_HASH'" > /dev/null
      ok "$COUNT_BY_HASH eventos removidos por email_hash"; REMOVED=$((REMOVED+COUNT_BY_HASH))
    fi
  else
    skip "Nenhum evento encontrado por email_hash"
  fi
else
  # Profile exclusivo: apagar por profile_id + email_hash
  COUNT_BY_PROFILE=$(d1_query "$EVENT_DB" \
    "SELECT COUNT(*) as n FROM funnel_events WHERE profile_id IN ($PROFILE_IDS)" \
    | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0]?.n ?? 0)")
  COUNT_BY_HASH=$(d1_query "$EVENT_DB" \
    "SELECT COUNT(*) as n FROM funnel_events WHERE email_hash = '$EMAIL_HASH' AND (profile_id IS NULL OR profile_id NOT IN ($PROFILE_IDS))" \
    | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0]?.n ?? 0)")
  TOTAL_EVENTS=$((COUNT_BY_PROFILE + COUNT_BY_HASH))

  if $DRY_RUN; then
    [[ "$COUNT_BY_PROFILE" -gt 0 ]] && dry "DELETE $COUNT_BY_PROFILE eventos por profile_id (profile exclusivo)"
    [[ "$COUNT_BY_HASH" -gt 0 ]]    && dry "DELETE $COUNT_BY_HASH eventos por email_hash (sem profile)"
    [[ "$TOTAL_EVENTS" -eq 0 ]]     && skip "Nenhum evento encontrado"
  else
    [[ "$COUNT_BY_PROFILE" -gt 0 ]] && {
      d1_exec "$EVENT_DB" "DELETE FROM funnel_events WHERE profile_id IN ($PROFILE_IDS)" > /dev/null
      ok "$COUNT_BY_PROFILE eventos removidos por profile_id"
    }
    [[ "$COUNT_BY_HASH" -gt 0 ]] && {
      d1_exec "$EVENT_DB" "DELETE FROM funnel_events WHERE email_hash = '$EMAIL_HASH' AND (profile_id IS NULL OR profile_id NOT IN ($PROFILE_IDS))" > /dev/null
      ok "$COUNT_BY_HASH eventos adicionais removidos por email_hash"
    }
    [[ "$TOTAL_EVENTS" -eq 0 ]] && skip "Nenhum evento encontrado"
    REMOVED=$((REMOVED+TOTAL_EVENTS))
  fi
fi

# ── Sumário ───────────────────────────────────────────────────────────────────

section "Sumário"
echo -e "  Email:    ${BOLD}$EMAIL_LOWER${NC}"
if $DRY_RUN; then
  echo -e "  ${YELLOW}Modo dry-run — execute sem --dry-run para apagar definitivamente${NC}"
else
  echo -e "  ${GREEN}${BOLD}$REMOVED registos removidos de todos os sistemas${NC}"
fi
echo ""
