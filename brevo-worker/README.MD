# Brevo Worker (Cloudflare)

Worker que recebe dados do pre-checkout, cria/atualiza contato no Brevo e redireciona o usuario.
Suporta fluxo com Double Opt-in (DOI) e fluxo sem DOI.

## Rotas
- `https://api.decolesuacarreiraesg.com.br/brevo*`

## Fluxo principal
1. Recebe POST (ou GET em modo debug).
2. Valida e-mail.
3. (Opcional) valida Turnstile.
4. Envia contato ao Brevo:
   - com DOI: `POST /v3/contacts/doubleOptinConfirmation`
   - sem DOI: `POST /v3/contacts`
5. Redireciona para a oferta (Hotmart) ou retorna JSON.
6. No DOI, o Brevo redireciona para a pagina de confirmacao.

## Redirecionamentos
- **POST_SUBMIT_REDIRECT_URL**: destino imediato apos submit (normalmente oferta).
- **BREVO_DOI_REDIRECT_URL**: destino apos confirmacao do e-mail (DOI).
- Ambos recebem parametros do lead anexados na query string.

## Parametros aceitos
O worker aceita JSON ou `application/x-www-form-urlencoded`.

Campos suportados (principais):
- `EMAIL` / `email`
- `FIRSTNAME` / `first_name`
- `LASTNAME` / `last_name`
- `SMS` / `phone`
- `SMS__COUNTRY_CODE` / `country_code`
- `DOC` / `doc` / `CPF` / `CNPJ`
- `ZIP` / `zip` / `CEP`

Os dados sao normalizados e enviados ao Brevo. Para Hotmart e redirecionamentos, estes params sao repassados:
- `name`, `email`, `doc`, `zip`, `phoneac`, `phonenumber`
- `first_name`, `last_name`, `phone`, `phone_country`
- `EMAIL`, `FIRSTNAME`, `LASTNAME`, `SMS`, `SMS__COUNTRY_CODE`

## Modo debug
Ative com:
- `?debug_redirect=1` na URL, ou
- header `x-debug-redirect: 1`

Em debug, o worker responde JSON com:
- `useDoi`, `redirectUrl`, `doiRedirectUrl`, `params`

## Variaveis (wrangler.toml)
- `ALLOWED_ORIGIN` (ex.: `https://decolesuacarreiraesg.com.br` ou lista separada por virgula)
- `BREVO_LIST_ID`
- `BREVO_DOI_TEMPLATE_ID`
- `POST_SUBMIT_REDIRECT_URL`
- `BREVO_DOI_REDIRECT_URL`
- `TURNSTILE_SECRET` (se usar captcha)
- `BREVO_API_KEY` (secret no ambiente)

Observacao de CORS:
- O worker tambem permite a origem fixa `http://192.168.1.67:8080`.

## Respostas
- `200` JSON quando nao ha redirect
- `303` redirect quando `POST_SUBMIT_REDIRECT_URL` existe
- `400` para erros de validacao
- `403` origem nao permitida
- `405` metodo nao permitido
- `502` erro do Brevo

## Smoke test pos-deploy
Execute:
- `npm run smoke`

Variaveis opcionais:
- `SMOKE_URL` (default: `https://api.decolesuacarreiraesg.com.br/brevo`)
- `SMOKE_ORIGIN` (default: `https://decolesuacarreiraesg.com.br`)
- `SMOKE_EXPECTED_STATUS` (default: `400`)
- `SMOKE_EXPECTED_ERROR` (default: `email_required`)
- `SMOKE_MAX_ATTEMPTS` (default: `10`)
- `SMOKE_DELAY_MS` (default: `3000`)

## Observacoes
- A normalizacao de telefone tenta incluir codigo do pais.
- O split `phoneac`/`phonenumber` usa heuristica por pais.
- O redirect do DOI adiciona os mesmos parametros do lead.

## Arquivos
- `src/index.ts` - logica do worker
- `wrangler.toml` - configuracao e variaveis
