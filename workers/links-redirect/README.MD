# DECOLE Links Redirect Worker (Cloudflare)

Worker responsavel por mapear paths estaticos em links dinamicos (ex.: WhatsApp).

## Rotas

- `https://links.decolesuacarreiraesg.com.br/elizete-wp`
  - Redireciona para o chat do WhatsApp da Elizete.
  - Parametros opcionais:
    - `text` ou `t`: mensagem inicial.
- `https://links.decolesuacarreiraesg.com.br/checkout_mentoria?v=1`
  - Redireciona para o checkout configurado.
  - Parametros opcionais:
    - `v`: versao do checkout (`1`, `2`).
    - outros query params sao repassados para o destino.

## Variaveis

- `ELIZETE_WHATSAPP_NUMBER` (ex.: `5511999999999`)
- `ELIZETE_WHATSAPP_DEFAULT_TEXT` (opcional)
- `CHECKOUT_MENTORIA_URL_DEFAULT` (fallback)
- `CHECKOUT_MENTORIA_URL_V1`
- `CHECKOUT_MENTORIA_URL_V2`

## Healthcheck

- `GET /health` -> `{ ok: true, worker: "links-redirect" }`
