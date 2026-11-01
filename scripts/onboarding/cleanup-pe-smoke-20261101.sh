#!/usr/bin/env bash
# Remove the three PE smoke-test sign-ups of 2026-11-01 (Brevo PE account + D1). Dry run by default.
# Usage: bash cleanup-pe-smoke.sh            (show what would be removed)
#        bash cleanup-pe-smoke.sh --apply    (remove)
set -euo pipefail
APPLY=false; [[ "${1:-}" == "--apply" ]] && APPLY=true
envget() { grep "^$1=" ~/.env.local | tail -1 | cut -d= -f2- | sed "s/^'//;s/'$//"; }
BREVO_KEY=$(envget BREVO_API_KEY_PRODUCT_ENGINEER)
export CLOUDFLARE_API_TOKEN=$(envget CLOUDFLARE_API_TOKEN) CLOUDFLARE_ACCOUNT_ID=$(envget CLOUDFLARE_ACCOUNT_ID)
EMAILS=(chicoria+pe-smoke-20261101@gmail.com chicoria+pe-smoke-20261101b@gmail.com chicoria+pe-smoke-20261101c@gmail.com)
PROFILES="'168881fc-9433-4725-8720-678121dc2375','369f7517-b684-438b-9370-63b3b0e6fc4b','691aac56-f99e-47a8-a1e3-e4175a6d8bb6'"
cd ~/git/funil-mkt-platform/workers/funnel-dispatcher
d1() { npx wrangler d1 execute "$1" --remote --json --command "$2" 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin)[0];print('   ',d.get('results') or d.get('meta',{}).get('changes'))"; }

echo "Brevo (PE account):"
for e in "${EMAILS[@]}"; do
  q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$e")
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "api-key: $BREVO_KEY" "https://api.brevo.com/v3/contacts/$q")
  echo "  $e exists=$code"
  $APPLY && [[ $code == 200 ]] && echo "    DELETE $(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "api-key: $BREVO_KEY" "https://api.brevo.com/v3/contacts/$q")"
done

echo "D1 decole-d1-event-store funnel_events (product-engineer, test profiles):"
d1 decole-d1-event-store "SELECT COUNT(*) n FROM funnel_events WHERE tenant_id='product-engineer' AND profile_id IN ($PROFILES)"
$APPLY && d1 decole-d1-event-store "DELETE FROM funnel_events WHERE tenant_id='product-engineer' AND profile_id IN ($PROFILES)"

echo "D1 decole-d1-identity identity_links (product-engineer, test profiles):"
d1 decole-d1-identity "SELECT COUNT(*) n FROM identity_links WHERE tenant_id='product-engineer' AND profile_id IN ($PROFILES)"
$APPLY && d1 decole-d1-identity "DELETE FROM identity_links WHERE tenant_id='product-engineer' AND profile_id IN ($PROFILES)"

$APPLY && echo "Done. Rerun without --apply to confirm zeros." || echo "Dry run only. Rerun with --apply to remove."
