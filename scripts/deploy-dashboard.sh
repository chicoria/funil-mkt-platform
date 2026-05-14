#!/usr/bin/env bash
# Setup script for decole-dashboard Cloudflare Pages deployment.
# Reads credentials from ../.env.local and secrets/ paths that already exist
# in the monorepo, so no manual secret-typing is needed for known values.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Repo root = parent of scripts/ (funil-mkt-platform)
FUNIL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASHBOARD="$(cd "$FUNIL_ROOT/../decole-dashboard" && pwd)"
ENV_LOCAL="$FUNIL_ROOT/.env.local"
BACKEND="$FUNIL_ROOT"
ROOT="$DASHBOARD"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✔  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
die()  { echo -e "${RED}✖  $*${NC}" >&2; exit 1; }
step() { echo -e "\n${YELLOW}▶  $*${NC}"; }

# ──────────────────────────────────────────────────────────
# 0. Prereqs
# ──────────────────────────────────────────────────────────
step "Checking prerequisites"
command -v npx     >/dev/null 2>&1 || die "npx not found — install Node.js"
command -v python3 >/dev/null 2>&1 || die "python3 not found"
[[ -f "$ENV_LOCAL" ]] || die ".env.local not found at $ENV_LOCAL"
ok "Prerequisites OK"

# Load env vars from .env.local (ignore comments, blank lines, redacted)
while IFS= read -r line; do
  [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
  [[ "$line" =~ .*'<redacted>'.*$ ]] && continue
  export "${line?}" 2>/dev/null || true
done < "$ENV_LOCAL"

# ──────────────────────────────────────────────────────────
# 1. Resolve D1 database IDs and patch wrangler.toml
# ──────────────────────────────────────────────────────────
step "Resolving D1 database IDs"

D1_LIST=$(npx wrangler d1 list --json 2>/dev/null) \
  || die "wrangler d1 list failed — are you logged in? Run: npx wrangler login"

EVENT_DB_ID=$(echo "$D1_LIST" | python3 -c "
import sys, json
dbs = json.load(sys.stdin)
hit = next((d for d in dbs if d.get('name') == 'decole-d1-event-store'), None)
print(hit['uuid'] if hit else '')
" 2>/dev/null || true)

IDENTITY_DB_ID=$(echo "$D1_LIST" | python3 -c "
import sys, json
dbs = json.load(sys.stdin)
hit = next((d for d in dbs if d.get('name') == 'decole-d1-identity'), None)
print(hit['uuid'] if hit else '')
" 2>/dev/null || true)

[[ -n "$EVENT_DB_ID" ]]    || die "D1 'decole-d1-event-store' not found. Create: npx wrangler d1 create decole-d1-event-store"
[[ -n "$IDENTITY_DB_ID" ]] || die "D1 'decole-d1-identity' not found. Create: npx wrangler d1 create decole-d1-identity"

ok "decole-d1-event-store → $EVENT_DB_ID"
ok "decole-d1-identity    → $IDENTITY_DB_ID"

WRANGLER_TOML="$ROOT/wrangler.toml"
# Patch each database_id line that follows the matching database_name line
python3 - "$WRANGLER_TOML" "$EVENT_DB_ID" "$IDENTITY_DB_ID" <<'PYEOF'
import sys, re

path, event_id, identity_id = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    text = f.read()

def replace_id(text, db_name, new_id):
    pattern = rf'(database_name = "{re.escape(db_name)}"[^\[]*?database_id = )"[^"]*"'
    return re.sub(pattern, rf'\1"{new_id}"', text, flags=re.DOTALL)

text = replace_id(text, "decole-d1-event-store", event_id)
text = replace_id(text, "decole-d1-identity", identity_id)

with open(path, "w") as f:
    f.write(text)
PYEOF
ok "wrangler.toml patched"

# ──────────────────────────────────────────────────────────
# 2. Apply D1 schemas
# ──────────────────────────────────────────────────────────
step "Applying D1 schemas to decole-d1-event-store"

GA4_SQL="$BACKEND/config/d1/ga4_daily_metrics.sql"
META_SQL="$BACKEND/config/d1/meta_daily_metrics.sql"

[[ -f "$GA4_SQL" ]]  || die "Missing: $GA4_SQL"
[[ -f "$META_SQL" ]] || die "Missing: $META_SQL"

npx wrangler d1 execute decole-d1-event-store --remote --file="$GA4_SQL"
ok "ga4_daily_metrics applied"

npx wrangler d1 execute decole-d1-event-store --remote --file="$META_SQL"
ok "meta_daily_metrics applied"

# ──────────────────────────────────────────────────────────
# 3. Create Cloudflare Pages project (idempotent)
# ──────────────────────────────────────────────────────────
step "Ensuring Cloudflare Pages project exists"

if npx wrangler pages project list 2>/dev/null | grep -q "decole-dashboard"; then
  ok "Project decole-dashboard already exists"
else
  npx wrangler pages project create decole-dashboard --production-branch main
  ok "Project decole-dashboard created"
fi

# ──────────────────────────────────────────────────────────
# 4. Push secrets to Cloudflare Pages
# ──────────────────────────────────────────────────────────
step "Pushing secrets to Cloudflare Pages (decole-dashboard)"

push_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    warn "Skipping $name — value is empty"
    return
  fi
  printf '%s' "$value" | npx wrangler pages secret put "$name" \
    --project-name decole-dashboard
  ok "$name"
}

# ADMIN_SECRET — from .env.local
push_secret "ADMIN_SECRET" "${ADMIN_SECRET:-}"

# GA4_PROPERTY_ID — from .env.local (numeric ID, e.g. 507112601)
push_secret "GA4_PROPERTY_ID" "${GA4_PROPERTY_ID:-}"

# GA4_SERVICE_ACCOUNT_KEY — read the JSON file referenced in .env.local
GA4_SA_FILE="${GOOGLE_SERVICE_ACCOUNT_JSON:-}"
if [[ -f "$GA4_SA_FILE" ]]; then
  GA4_SA_JSON=$(cat "$GA4_SA_FILE")
  push_secret "GA4_SERVICE_ACCOUNT_KEY" "$GA4_SA_JSON"
else
  warn "GA4_SERVICE_ACCOUNT_KEY skipped — file not found: $GA4_SA_FILE"
  warn "Set GOOGLE_SERVICE_ACCOUNT_JSON in .env.local or paste the JSON manually later"
fi

# META_ACCESS_TOKEN — use the system user token from .env.local
push_secret "META_ACCESS_TOKEN" "${META_SYSTEM_USER_ACCESS_TOKEN:-}"

# Meta ad account — same account for all products, only pixels differ per product
META_AD_ACCOUNT="act_${META_AD_ACCOUNT_ID:-}"
push_secret "META_AD_ACCOUNT_ID_ESG"      "$META_AD_ACCOUNT"
push_secret "META_AD_ACCOUNT_ID_PLANOVOO" "$META_AD_ACCOUNT"

# ──────────────────────────────────────────────────────────
# 5. Install deps
# ──────────────────────────────────────────────────────────
step "Installing npm dependencies"
cd "$ROOT"
npm install --legacy-peer-deps
ok "Dependencies installed"

# ──────────────────────────────────────────────────────────
# 5. Build for Cloudflare Pages
# ──────────────────────────────────────────────────────────
step "Building for Cloudflare Pages"
npm run pages:build
ok "Build complete"

# ──────────────────────────────────────────────────────────
# 6. Deploy Pages (Next.js dashboard)
# ──────────────────────────────────────────────────────────
step "Deploying to Cloudflare Pages"
npx wrangler pages deploy .vercel/output/static \
  --project-name decole-dashboard \
  --branch main
ok "Pages deployed"

# ──────────────────────────────────────────────────────────
# 7. Deploy dashboard-sync Worker (cron GA4 + Meta)
# ──────────────────────────────────────────────────────────
step "Deploying dashboard-sync Worker (cron 0 4 * * *)"

SYNC_WORKER="$BACKEND/workers/dashboard-sync"
cd "$SYNC_WORKER"

npm install --silent

# Push secrets to the Worker
push_worker_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    warn "Skipping worker secret $name — empty"
    return
  fi
  printf '%s' "$value" | npx wrangler secret put "$name"
  ok "worker: $name"
}

push_worker_secret "GA4_SERVICE_ACCOUNT_KEY"   "$GA4_SA_JSON"
push_worker_secret "GA4_PROPERTY_ID"           "${GA4_PROPERTY_ID:-}"
push_worker_secret "META_ACCESS_TOKEN"         "${META_SYSTEM_USER_ACCESS_TOKEN:-}"
push_worker_secret "META_AD_ACCOUNT_ID_ESG"    "$META_AD_ACCOUNT"
push_worker_secret "META_AD_ACCOUNT_ID_PLANOVOO" "$META_AD_ACCOUNT"
push_worker_secret "SYNC_SECRET"               "${ADMIN_SECRET:-}"

npx wrangler deploy
ok "dashboard-sync Worker deployed"

cd "$ROOT"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Dashboard deployed successfully!${NC}"
echo -e "${GREEN}  Pages: https://decole-dashboard.pages.dev${NC}"
echo -e "${GREEN}  Worker cron: decole-dashboard-sync (4h UTC diário)${NC}"
echo -e "${GREEN}  Custom DNS: dashboard.decolesuacarreiraesg.com.br${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Trigger manual do sync:"
echo "  curl 'https://decole-dashboard-sync.<account>.workers.dev/sync?secret=\$ADMIN_SECRET&date=2026-04-28'"
echo ""
echo "  Próximos passos:"
echo "  • Configurar custom domain em Cloudflare Pages → Settings → Custom domains"
