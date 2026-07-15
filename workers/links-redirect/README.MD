# DECOLE Links Redirect Worker (Cloudflare)

Worker responsavel por mapear paths estaticos em links dinamicos (ex.: WhatsApp).

Nos redirects de checkout, o worker emite `BEGIN_CHECKOUT` para `FUNNEL_EVENTS` antes de retornar o `302` para a Hotmart. Esse evento alimenta o estado de funil/event store; analytics continua no trilho GTM Web/sGTM.

Links de recuperação enviados pelo Brevo podem usar `rid=<token>`. O worker resolve `checkout_recovery:<token>` no `IDENTITY_KV`, remove o token da URL pública e adiciona apenas parâmetros permitidos ao redirect final para a Hotmart (`email`, `name`, telefone, UTMs e ids de tracking).

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

### Slugs de referral por canal (`channel_referral`)

Redirect puro (`302`) para a landing page do produto, aplicando `defaultParams`
(`utm_source`, `utm_medium`, `utm_campaign`) somente quando ausentes na query
string recebida. Não emite evento de funil — a atribuição é capturada pelo
GTM Web/GA4 na própria visita à landing page.

Slugs ativos: `cecilia`, `deise`, `efazza`, `carreira-esg`, `biancamosquera`.

- Plano de Voo (`/planodevoo/ref/{slug}` → `DECOLE_PLANOVOO`):
  - `https://links.decolesuacarreiraesg.com.br/planodevoo/ref/cecilia`
  - `https://links.decolesuacarreiraesg.com.br/planodevoo/ref/deise`
  - `https://links.decolesuacarreiraesg.com.br/planodevoo/ref/efazza`
  - `https://links.decolesuacarreiraesg.com.br/planodevoo/ref/carreira-esg`
  - `https://links.decolesuacarreiraesg.com.br/planodevoo/ref/biancamosquera`
- Decole ESG (`/ref/{slug}` → `DECOLE_ESG_MENTORIA`):
  - `https://links.decolesuacarreiraesg.com.br/ref/cecilia`
  - `https://links.decolesuacarreiraesg.com.br/ref/deise`
  - `https://links.decolesuacarreiraesg.com.br/ref/efazza`
  - `https://links.decolesuacarreiraesg.com.br/ref/carreira-esg`
  - `https://links.decolesuacarreiraesg.com.br/ref/biancamosquera`

## Variaveis

- `ELIZETE_WHATSAPP_NUMBER` (ex.: `5511999999999`)
- `ELIZETE_WHATSAPP_DEFAULT_TEXT` (opcional)
- `LINKS_PRODUCTS` (JSON multiproduto: `[{checkoutPath, checkoutBaseUrl, productCode}]`)
- `FUNNEL_EVENTS` (queue producer para `decole-q-funnel-events`)
- `IDENTITY_KV` (leitura dos tokens `checkout_recovery:*` gerados pelo dispatcher)
- `DECOLE_MENTORIA_CHECKOUT_URL` (fallback)
- `PLANO_DE_VOO_CHECKOUT_URL` (checkout do Plano de Voo)

## Healthcheck

- `GET /health` -> `{ ok: true, worker: "links-redirect" }`
