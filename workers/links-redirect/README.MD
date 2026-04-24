# DECOLE Links Redirect Worker (Cloudflare)

Worker responsavel por mapear paths estaticos em links dinamicos (ex.: WhatsApp).

Nos redirects de checkout, o worker emite `BEGIN_CHECKOUT` para `FUNNEL_EVENTS` antes de retornar o `302` para a Hotmart. Esse evento alimenta o estado de funil/event store; analytics continua no trilho GTM Web/sGTM.

## Rotas

- `https://links.decolesuacarreiraesg.com.br/elizete-wp`
  - Redireciona para o chat do WhatsApp da Elizete.
  - Parametros opcionais:
    - `text` ou `t`: mensagem inicial.
- `https://links.decolesuacarreiraesg.com.br/decole-esg/checkout`
  - Redireciona para o checkout configurado.
  - Parametros opcionais:
    - `off`: sobrescreve o `off` do checkout.
    - `offer` (ou `offer_id`): sobrescreve o `off` e envia `offer` no destino.
    - outros query params sao repassados para o destino.
- `https://links.decolesuacarreiraesg.com.br/decole-esg/checkout/offer/{codigo}`
  - Sobrescreve a oferta via path (ex.: `/decole-esg/checkout/offer/3j6lto4t`).
- `https://links.decolesuacarreiraesg.com.br/plano-de-voo/checkout`
  - Redireciona para o checkout do Plano de Voo.
  - Parametros opcionais:
    - `off`: sobrescreve o `off` do checkout.
    - `offer` (ou `offer_id`): sobrescreve o `off` e envia `offer` no destino.
    - outros query params sao repassados para o destino.
- `https://links.decolesuacarreiraesg.com.br/plano-de-voo/checkout/offer/{codigo}`
  - Sobrescreve a oferta via path (ex.: `/plano-de-voo/checkout/offer/abc123`).

## Variaveis

- `ELIZETE_WHATSAPP_NUMBER` (ex.: `5511999999999`)
- `ELIZETE_WHATSAPP_DEFAULT_TEXT` (opcional)
- `LINKS_PRODUCTS` (JSON multiproduto: `[{checkoutPath, checkoutBaseUrl, productCode}]`)
- `FUNNEL_EVENTS` (queue producer para `decole-q-funnel-events`)
- `DECOLE_MENTORIA_CHECKOUT_URL` (fallback)
- `PLANO_DE_VOO_CHECKOUT_URL` (checkout do Plano de Voo)

## Healthcheck

- `GET /health` -> `{ ok: true, worker: "links-redirect" }`
