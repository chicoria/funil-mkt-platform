#!/usr/bin/env bash
# tail-workers.sh — Acompanha logs de múltiplos Workers em paralelo
# Uso: ./scripts/tail-workers.sh [worker1 worker2 ...]
# Sem argumentos: descobre e acompanha todos os workers do projeto

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

# Cores ANSI
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
MAGENTA=$'\033[0;35m'
BLUE=$'\033[0;34m'
RED=$'\033[0;31m'
RESET=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'

worker_color() {
  case "$1" in
    *funnel-dispatcher*)  printf '%s' "$GREEN" ;;
    *hotmart-ingress*)    printf '%s' "$YELLOW" ;;
    *funnel-ingress*)     printf '%s' "$CYAN" ;;
    *links-redirect*)     printf '%s' "$MAGENTA" ;;
    *dashboard-sync*)     printf '%s' "$BLUE" ;;
    *)                    printf '%s' "$RESET" ;;
  esac
}

# Workers a acompanhar: argumentos ou TODOS os workers do projeto
if [ $# -gt 0 ]; then
  WORKERS=("$@")
else
  WORKERS=()
  WORKERS_DIR="$ROOT_DIR/workers"
  while IFS= read -r toml; do
    name=$(grep '^name' "$toml" | head -1 | sed 's/name *= *"\(.*\)"/\1/')
    [ -n "$name" ] && WORKERS+=("$name")
  done < <(find "$WORKERS_DIR" -name "wrangler.toml" | sort)
fi

echo ""
echo -e "${BOLD}Cloudflare Workers Tail${RESET}"
echo "────────────────────────"
for w in "${WORKERS[@]}"; do
  color=$(worker_color "$w")
  echo -e "  ${color}●${RESET} $w"
done
echo "────────────────────────"
echo -e "${DIM}Ctrl+C para parar${RESET}"
echo ""

tail_worker() {
  local name="$1"
  local color
  color=$(worker_color "$name")
  local label
  label=$(echo "$name" | sed 's/decole-//' | cut -c1-20)
  local pad
  printf -v pad "%-20s" "$label"

  # Parser Python: acumula JSON multi-linha do wrangler antes de processar.
  # Linha que começa com '{' abre um objeto; linha com '}' sozinha fecha.
  # Linhas fora de JSON são mensagens de status do wrangler (conexão, erros).
  npx wrangler tail "$name" --format json 2>&1 \
  | COLOR="$color" PAD="$pad" python3 -u -c '
import sys, json, datetime, os

color = os.environ["COLOR"]
pad = os.environ["PAD"]
RESET = "\033[0m"
RED = "\033[0;31m"
DIM = "\033[2m"

def ts_str(ms):
    try:
        return datetime.datetime.fromtimestamp(ms / 1000).strftime("%H:%M:%S")
    except Exception:
        return "??:??:??"

def emit(tag, ts, msg, col=None):
    c = col or ""
    print(f"{color}{pad}{RESET} {c}[{tag}] {ts}  {msg}{RESET}", flush=True)

def handle_event(d):
    ts = ts_str(d.get("eventTimestamp", 0))

    # Exceptions → vermelho
    for ex in d.get("exceptions", []):
        ex_name = ex.get("name", "Error")
        ex_msg = ex.get("message", "")
        emit("EXCEPTION", ts,
             f"{ex_name}: {ex_msg}",
             col=RED)

    # Logs → saída normal
    for log in d.get("logs", []):
        msg = log.get("message", "")
        if isinstance(msg, list):
            msg = " ".join(str(m) for m in msg)
        emit("log", ts, msg)

    # Sem logs nem exceptions: mostrar outcome apenas (sem spam de requests)
    if not d.get("logs") and not d.get("exceptions"):
        outcome = d.get("outcome", "?")
        url = (d.get("event") or {}).get("request", {}).get("url", "")
        # Suprimir bots e healthchecks ruidosos
        ua = (d.get("event") or {}).get("request", {}).get("headers", {}).get("user-agent", "")
        if "bot" in ua.lower() or "crawler" in ua.lower() or "spider" in ua.lower():
            return
        summary = f"outcome={outcome}"
        if url:
            summary += f"  {url}"
        emit("event", ts, summary, col=DIM)

buf = []

for raw in sys.stdin:
    line = raw.rstrip()
    stripped = line.strip()

    # Início de objeto JSON
    if not buf and stripped.startswith("{"):
        if stripped.endswith("}"):
            try:
                handle_event(json.loads(stripped))
            except Exception:
                print(f"{color}{pad}{RESET} {DIM}{line}{RESET}", flush=True)
            continue
        buf = [line]
        continue

    # Dentro de objeto JSON em acumulação
    if buf:
        buf.append(line)
        if line.rstrip() == "}":
            try:
                d = json.loads("\n".join(buf))
            except Exception:
                buf = []
                continue
            buf = []
            handle_event(d)
        continue

    # Linha fora de JSON → mensagem de status do wrangler
    if stripped:
        print(f"{color}{pad}{RESET} {DIM}{line}{RESET}", flush=True)

print(f"{color}{pad}{RESET} {RED}[desconectado]{RESET}", flush=True)
'
}

# Executar todos em paralelo
pids=()
for worker in "${WORKERS[@]}"; do
  tail_worker "$worker" &
  pids+=($!)
done

trap 'echo ""; echo "Parando..."; kill "${pids[@]}" 2>/dev/null; exit 0' INT TERM

wait "${pids[@]}"
