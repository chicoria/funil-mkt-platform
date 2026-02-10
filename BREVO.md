# Configuracao Brevo (DECOLE)

Documentacao central de configuracao do Brevo para os workers do projeto.

## 1. API Key
1. No Brevo, va em `SMTP & API` (ou `API Keys`).
2. Crie uma API key e copie o valor.
3. Configure como secret no Cloudflare:
   - `BREVO_API_KEY`

## 2. Listas (se usar listas por evento)
Crie as listas no Brevo e copie os IDs:
- `BREVO_LIST_ID` (api-precheckout)
- `BREVO_LIST_BEGIN_CHECKOUT` (api-events-consumer)
- `BREVO_LIST_PURCHASE` (api-events-consumer)
- `BREVO_LIST_CART_ABANDONMENT` (api-events-consumer)

## 3. DOI (Double Opt-In) para precheckout
1. Crie o template de DOI no Brevo.
2. Pegue o ID do template e configure:
   - `BREVO_DOI_TEMPLATE_ID`
3. Defina a URL de redirect apos confirmacao:
   - `BREVO_DOI_REDIRECT_URL`

## 4. Atributos de contato
Os atributos precisam existir antes do envio. Os nomes devem ser enviados em MAIUSCULAS.

Sugestao de atributos customizados:
- `LEAD_ID`
- `UTM_SOURCE`, `UTM_MEDIUM`, `UTM_CAMPAIGN`, `UTM_CONTENT`, `UTM_TERM`
- `FBP`, `FBC`, `FBCLID`

### Tags via atributos (recomendado)
Se preferir tags por evento, crie um atributo customizado, por exemplo:
- `HOTMART_TAGS` (tipo multi-choice ou texto)

Depois segmente no painel do Brevo por esse atributo.

## 5. Atributo WHATSAPP
Para o atributo `WHATSAPP` aparecer na lista de atributos do contato:
1. Ative o canal em `Campanhas > WhatsApp` no Brevo.
2. O atributo `WHATSAPP` passa a ficar disponivel para atualizacao via API.

## 6. Workers: variaveis por projeto
### api-precheckout
- `BREVO_API_KEY` (secret)
- `BREVO_LIST_ID`
- `BREVO_DOI_TEMPLATE_ID`
- `BREVO_DOI_REDIRECT_URL`

### api-events-consumer (listas)
- `BREVO_API_KEY` (secret)
- `BREVO_LIST_BEGIN_CHECKOUT`
- `BREVO_LIST_PURCHASE`
- `BREVO_LIST_CART_ABANDONMENT`

### api-events-consumer (tags via atributos)
- Sem variaveis novas, mas exige atributos criados no Brevo.
- Use o script de experimento para validar o update:
  - `node backend/cloudflare/workers/api-events-consumer/scripts/brevo-tag-experiment.mjs`

## 7. Validacao rapida
Use o script de experimento para validar atributos:
```bash
BREVO_API_KEY=... \
BREVO_CONTACT_EMAIL=... \
node backend/cloudflare/workers/api-events-consumer/scripts/brevo-tag-experiment.mjs
```

