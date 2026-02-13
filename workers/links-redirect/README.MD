# DECOLE Links Redirect Worker (Cloudflare)

Worker responsavel por mapear paths estaticos em links dinamicos (ex.: WhatsApp).

## Rotas

- `https://links.decolesuacarreiraesg.com.br/elizete-wp`
  - Redireciona para o chat do WhatsApp da Elizete.
  - Parametros opcionais:
    - `text` ou `t`: mensagem inicial.
- `https://links.decolesuacarreiraesg.com.br/checkout`
  - Redireciona para o checkout configurado.
  - Parametros opcionais:
    - `off` (ou `offer`, `offer_id`): sobrescreve o `off` do checkout.
    - outros query params sao repassados para o destino.

## Variaveis

- `ELIZETE_WHATSAPP_NUMBER` (ex.: `5511999999999`)
- `ELIZETE_WHATSAPP_DEFAULT_TEXT` (opcional)
- `CHECKOUT_URL` (fallback)

## Healthcheck

- `GET /health` -> `{ ok: true, worker: "links-redirect" }`
