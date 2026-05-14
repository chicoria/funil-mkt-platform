#!/usr/bin/env bash
# check-pending-placeholders.sh
#
# Verifica se há placeholders _PENDENTE nos arquivos de configuração
# dos workers. Deve ser executado antes de qualquer deploy.
#
# Uso:
#   ./backend/cloudflare/scripts/check-pending-placeholders.sh
#   ./backend/cloudflare/scripts/check-pending-placeholders.sh --worker funnel-dispatcher

set -euo pipefail

CLOUDFLARE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_NAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --worker)
      if [ -z "${2:-}" ]; then
        echo "ERRO: --worker requer o nome do worker."
        exit 2
      fi
      WORKER_NAME="$2"
      shift 2
      ;;
    --worker=*)
      WORKER_NAME="${1#--worker=}"
      shift
      ;;
    *)
      echo "ERRO: argumento desconhecido: $1"
      exit 2
      ;;
  esac
done

if [ -n "$WORKER_NAME" ]; then
  TARGET_FILES=("$CLOUDFLARE_DIR/workers/$WORKER_NAME/wrangler.toml")
  if [ ! -f "${TARGET_FILES[0]}" ]; then
    echo "ERRO: wrangler.toml não encontrado para worker '$WORKER_NAME'."
    exit 2
  fi
else
  TARGET_FILES=()
  while IFS= read -r f; do
    TARGET_FILES+=("$f")
  done < <(find "$CLOUDFLARE_DIR/workers" -name "wrangler.toml")
fi

FOUND=0
for file in "${TARGET_FILES[@]}"; do
  if [ ! -f "$file" ]; then continue; fi
  if grep -q "_PENDENTE" "$file" 2>/dev/null; then
    echo "❌ PLACEHOLDER ENCONTRADO: $file"
    grep -n "_PENDENTE" "$file" | sed 's/^/   /'
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "ERRO: Substitua os placeholders _PENDENTE antes de fazer deploy."
  echo "Veja .claude/backlog.md para instruções."
  exit 1
fi

echo "✅ Nenhum placeholder _PENDENTE encontrado."
