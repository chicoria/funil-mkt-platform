#!/usr/bin/env bash
# trace-contact.sh — Rastreia um contacto por email em todos os sistemas integrados.
#
# Uso:
#   source .env.local && bash scripts/trace-contact.sh chicoria@gmail.com
#   bash scripts/trace-contact.sh chicoria@gmail.com   (lê .env.local automaticamente)
#
# Sistemas cobertos:
#   1. Hash SHA-256 do email
#   2. Brevo — contacto, atributos, listas, DOI status
#   3. D1 IDENTITY — profile_id e anonymous_id linkados
#   4. D1 EVENT_STORE — historial de eventos do funil
#   5. KV (referência) — chaves de identidade esperadas

set -euo pipefail

# ── Argumentos e configuração ─────────────────────────────────────────────────

EMAIL="${1:-}"
if [[ -z "$EMAIL" ]]; then
  echo "Uso: bash scripts/trace-contact.sh <email>"
  echo "Exemplo: bash scripts/trace-contact.sh chicoria@gmail.com"
  exit 1
fi

# Carregar .env.local se existir
if [[ -f ".env.local" ]]; then
  set -a; source .env.local; set +a
fi

BREVO_KEY="${BREVO_API_KEY:-}"
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-c288163c00d98a307d770acae4032121}"
EVENT_DB="f5c19aac-2bdc-4fe4-b560-e1c49199ff4c"
IDENTITY_DB="e71a266a-b400-4970-a056-bf7223799f25"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

section() { echo ""; echo -e "${BLUE}${BOLD}══════════════════════════════════════════${NC}"; echo -e "${BLUE}${BOLD}  $1${NC}"; echo -e "${BLUE}${BOLD}══════════════════════════════════════════${NC}"; }
kv()      { printf "  ${GREEN}%-30s${NC} %s\n" "$1" "$2"; }
warn()    { echo -e "  ${YELLOW}⚠  $1${NC}"; }
err()     { echo -e "  ${RED}✘  $1${NC}"; }

d1_query() {
  local db="$1" sql="$2"
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/d1/database/$db/query" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sql\": $(echo "$sql" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8').trim()))")}" \
    | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(JSON.stringify(j.result?.[0]?.results ?? []))"
}

# ── 1. Email e hash ───────────────────────────────────────────────────────────

section "1. Email e identidade"

EMAIL_LOWER=$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
EMAIL_HASH=$(echo -n "$EMAIL_LOWER" | shasum -a 256 | cut -d' ' -f1)

kv "Email (normalizado):" "$EMAIL_LOWER"
kv "SHA-256 hash:" "$EMAIL_HASH"
echo ""
echo -e "  ${YELLOW}KV keys a procurar:${NC}"
echo "    identity:email:${EMAIL_HASH}  → profile_id"

# ── 2. Brevo ─────────────────────────────────────────────────────────────────

section "2. Brevo"

if [[ -z "$BREVO_KEY" ]]; then
  warn "BREVO_API_KEY não definido — a saltar"
else
  ENCODED_EMAIL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$EMAIL_LOWER'))")
  BREVO_RESPONSE=$(curl -s \
    "https://api.brevo.com/v3/contacts/$ENCODED_EMAIL?includeStatistics=false" \
    -H "api-key: $BREVO_KEY" \
    -H "Accept: application/json")

  if echo "$BREVO_RESPONSE" | grep -q '"code":"document_not_found"'; then
    err "Contacto NÃO encontrado no Brevo"
  elif echo "$BREVO_RESPONSE" | grep -q '"email"'; then
    echo "$BREVO_RESPONSE" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const c=JSON.parse(d);
const attr=c.attributes||{};
console.log('  \x1b[32mContacto encontrado\x1b[0m');
console.log('  ID Brevo:        ', c.id);
console.log('  Email:           ', c.email);
console.log('  DOI confirmado:  ', attr.DOUBLE_OPT_IN || '(não definido)');
console.log('  Email blocked:   ', c.emailBlacklisted ? 'SIM ⚠' : 'não');
console.log('');
console.log('  \x1b[33mAtributos de funil:\x1b[0m');
const funnelFields=['DECOLE_ESG_FUNIL_STEPS','DECOLE_ESG_FUNIL_LAST_STEP','DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP',
  'DECOLE_PLANOVOO_FUNIL_STEPS','DECOLE_PLANOVOO_FUNIL_LAST_STEP','DECOLE_PLANOVOO_FUNIL_LAST_STEP_TIMESTAMP'];
funnelFields.forEach(f => { if(attr[f]) console.log('  '+f+':', attr[f]); });
console.log('');
console.log('  \x1b[33mTracking:\x1b[0m');
['LEAD_ID','META_METADATA'].forEach(f => { if(attr[f]) console.log('  '+f+':', attr[f]); });
if(c.listIds && c.listIds.length>0) console.log('  Listas:', c.listIds.join(', '));
"
  else
    err "Erro Brevo: $(echo "$BREVO_RESPONSE" | node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(j.message||j.code||'resposta inesperada')")"
  fi
fi

# ── 3. D1 IDENTITY — profile_id e links ──────────────────────────────────────

section "3. D1 Identity — profile_id e links"

if [[ -z "$CF_TOKEN" ]]; then
  warn "CLOUDFLARE_API_TOKEN não definido — a saltar"
else
  IDENTITY_ROWS=$(d1_query "$IDENTITY_DB" \
    "SELECT profile_id, anonymous_id, email_hash, tenant_id, updated_at FROM identity_links WHERE email_hash = '$EMAIL_HASH' ORDER BY updated_at DESC")

  COUNT=$(echo "$IDENTITY_ROWS" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(r.length)")

  if [[ "$COUNT" == "0" ]]; then
    err "Email hash NÃO encontrado em identity_links"
    warn "O email pode nunca ter feito GENERATE_LEAD, ou foi desvinculado"
  else
    echo "$IDENTITY_ROWS" | node -e "
const rows=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
rows.forEach(r=>{
  console.log('  profile_id:   ', r.profile_id);
  console.log('  tenant_id:    ', r.tenant_id);
  console.log('  updated_at:   ', r.updated_at);
  console.log('');
});
"
    # Guardar profile_ids para usar nas próximas queries
    PROFILE_IDS=$(echo "$IDENTITY_ROWS" | node -e "
const rows=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const ids=[...new Set(rows.map(r=>r.profile_id))];
console.log(ids.map(id=>\"'\"+ id +\"'\").join(','));
")

    # Outros links do mesmo profile (outros emails/anon_ids)
    OTHER_LINKS=$(d1_query "$IDENTITY_DB" \
      "SELECT email_hash, anonymous_id, updated_at FROM identity_links WHERE profile_id IN ($PROFILE_IDS) ORDER BY updated_at")
    echo "$OTHER_LINKS" | node -e "
const rows=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const hash='$EMAIL_HASH';
const others=rows.filter(r=>r.email_hash && r.email_hash!==hash || r.anonymous_id);
if(others.length>0){
  console.log('  \x1b[33mOutros links do mesmo profile:\x1b[0m');
  others.forEach(r=>{
    if(r.email_hash) console.log('  email_hash:   ',r.email_hash,'(diferente — verificar merge)');
    if(r.anonymous_id) console.log('  anonymous_id: ',r.anonymous_id.slice(0,60));
  });
}
"
  fi
fi

# ── 4. D1 EVENT_STORE — historial de eventos ─────────────────────────────────

section "4. D1 Event Store — historial de eventos"

if [[ -z "$CF_TOKEN" ]]; then
  warn "CLOUDFLARE_API_TOKEN não definido — a saltar"
elif [[ -z "${PROFILE_IDS:-}" ]]; then
  warn "profile_id não encontrado — não é possível listar eventos"
else
  EVENTS=$(d1_query "$EVENT_DB" \
    "SELECT event_type, product_code, source, occurred_at, email_hash FROM funnel_events WHERE profile_id IN ($PROFILE_IDS) ORDER BY occurred_at ASC")

  echo "$EVENTS" | node -e "
const rows=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(rows.length===0){ console.log('  (nenhum evento encontrado)'); process.exit(0); }
const byProduct={};
rows.forEach(r=>{
  const k=r.product_code||'(sem produto)';
  byProduct[k]=byProduct[k]||[];
  byProduct[k].push(r);
});
Object.entries(byProduct).forEach(([prod,evts])=>{
  console.log('\n  \x1b[33m'+prod+'\x1b[0m');
  evts.forEach(e=>{
    const date=e.occurred_at.slice(0,16).replace('T',' ');
    const hasEmail=e.email_hash?'✉':'  ';
    console.log('    '+hasEmail+' '+date+'  '+e.event_type.padEnd(30,' ')+'  '+e.source);
  });
});
console.log('\n  Total: '+rows.length+' eventos');
"

  # Contagem por tipo
  echo ""
  COUNTS=$(d1_query "$EVENT_DB" \
    "SELECT event_type, COUNT(*) as n FROM funnel_events WHERE profile_id IN ($PROFILE_IDS) GROUP BY event_type ORDER BY n DESC")
  echo "$COUNTS" | node -e "
const rows=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(rows.length>0){
  console.log('  \x1b[33mContagem por tipo:\x1b[0m');
  rows.forEach(r=>console.log('    '+r.event_type.padEnd(35,' ')+r.n));
}
"
fi

# ── Sumário ───────────────────────────────────────────────────────────────────

section "Sumário"
echo -e "  Email rastreado: ${BOLD}$EMAIL_LOWER${NC}"
if [[ -n "${PROFILE_IDS:-}" ]]; then
  echo -e "  ${GREEN}✓ Profile encontrado${NC}"
else
  echo -e "  ${RED}✗ Profile não encontrado em D1${NC}"
fi
echo ""
