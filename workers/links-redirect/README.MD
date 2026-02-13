# DECOLE Links Redirect Worker (Cloudflare)

Worker responsavel por mapear paths estaticos em links dinamicos (ex.: WhatsApp).

## Rotas

- `https://links.decolesuacarreiraesg.com.br/elizete-wp`
  - Redireciona para o chat do WhatsApp da Elizete.
  - Parametros opcionais:
    - `text` ou `t`: mensagem inicial.
- `https://links.decolesuacarreiraesg.com.br/decole-esg/checkout`
  - Redireciona para o checkout configurado.
  - Parametros opcionais:
    - `off` (ou `offer`, `offer_id`): sobrescreve o `off` do checkout e define `offer`.
    - outros query params sao repassados para o destino.
- `https://links.decolesuacarreiraesg.com.br/decole-esg/checkout/offer/{codigo}`
  - Sobrescreve a oferta via path (ex.: `/decole-esg/checkout/offer/3j6lto4t`).

## Variaveis

- `ELIZETE_WHATSAPP_NUMBER` (ex.: `5511999999999`)
- `ELIZETE_WHATSAPP_DEFAULT_TEXT` (opcional)
- `CHECKOUT_URL` (fallback)

## Healthcheck

- `GET /health` -> `{ ok: true, worker: "links-redirect" }`
