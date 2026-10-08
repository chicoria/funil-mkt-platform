# Onboarding — Product Engineer (theproductengineer.net)

> Tenant ID: `product-engineer`
> Criado em: 2026-10-08
> Baseado em: [`RUNBOOK-ONBOARDING-TENANT.md`](../RUNBOOK-ONBOARDING-TENANT.md) v1.0
> **Este é o primeiro onboarding real do runbook** — só foi validado até hoje com um
> tenant fake (`superare-test`), nunca com um tenant de produção além da `decole`.
> Qualquer divergência do runbook descoberta aqui deve ser registrada em "Gotchas"
> de cada fatia e retroalimentada ao runbook.

## Contexto

O Product Engineer (`theproductengineer.net`, site pessoal do Adilson) precisa
de captura de lead (newsletter / lead magnet) com o mesmo padrão de tracking
GA4 que a DECOLE já usa — ver decisão completa na conversa que originou este
plano. Diferente da DECOLE, este tenant **não tem produto pago/Hotmart** nesta
fase — só eventos de funil de topo (lead).

## Decisões já tomadas (contexto da sessão que originou este plano)

- **Sem Hotmart/checkout.** Só captura de lead — sem `hotmart_token_env`, sem
  eventos `PURCHASE_*`/`BEGIN_CHECKOUT` no catálogo deste tenant.
- **Sem Meta Pixel/CAPI nesta fase.** Nenhuma entrada nas lookup tables de Meta
  (`LT - Meta Pixel ID by Tenant/Product`, `LT - Meta CAPI Token by Tenant`) —
  a tag Meta CAPI do sGTM compartilhado simplesmente não dispara pra esse
  tenant, sem precisar de trigger de bloqueio dedicado.
- **Captura de lead é form próprio + Cloudflare Pages Function**, fora do
  escopo deste runbook (Function guarda `BREVO_API_KEY_PRODUCT_ENGINEER`,
  Turnstile, rate-limit via KV) — documentado em
  `~/git/adilson-hub/media-hub/` (brief do lead magnet), não neste repo.
  Essa Function chama a Brevo direto; **não** passa pelo
  `api-funnel-ingress` nesta fase — ver "Fora de escopo" abaixo.
- **Single opt-in na Brevo** (sem DOI) — decisão de produto do Adilson, não
  do runbook.
- **Dashboard (`mkt-dashboard`) fora de escopo nesta fase** — Fatia 6 fica
  TODO/opcional, só se o Adilson quiser ver métricas do Product Engineer
  nesse painel compartilhado.

## IDs já obtidos (ver `~/.env.local`, não neste repo)

| Variável | Valor |
|---|---|
| `GTM_PUBLIC_ID_PRODUCT_ENGINEER` | `GTM-TK6V8G33` |
| `GTM_ACCOUNT_ID_PRODUCT_ENGINEER` | `6381217846` |
| `GTM_CONTAINER_ID_PRODUCT_ENGINEER` | `266435700` |
| `GTM_WORKSPACE_ID_PRODUCT_ENGINEER` | `2` |
| `GA4_MEASUREMENT_ID_PRODUCT_ENGINEER` | `G-LTQ72HWDXR` |
| `GA4_ACCOUNT_ID_PRODUCT_ENGINEER` | `411264354` |
| `GA4_PROPERTY_ID_PRODUCT_ENGINEER` | `558016766` |
| `BREVO_API_KEY_PRODUCT_ENGINEER` | já existe (conta Brevo dedicada, plano Free) |
| `GA4_API_SECRET_PRODUCT_ENGINEER` | **falta gerar** (GA4 Admin → Data Streams → Measurement Protocol API secrets) |

## Fora de escopo deste onboarding

- Qualquer coisa do fluxo de lead magnet em si (formulário, Function, Turnstile,
  Brevo automação) — vive em `media-hub`, consome só o
  `BREVO_API_KEY_PRODUCT_ENGINEER`, não depende de nenhuma fatia abaixo.
- Meta Pixel/Business Manager — decisão pendente, revisitar depois.
- `api-hotmart-ingress` — não aplicável, sem produto pago.

---

## Fatia 1 — DNS: `sgtm.theproductengineer.net` CNAME

> Satélite: onboarding `product-engineer` · Estimativa: 15 min + propagação

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |

### Pré-requisitos

- [ ] Acesso de escrita DNS na zona `theproductengineer.net` (hoje só tenho
      token read-only `CLOUDFLARE_API_READALL_TOKEN` — precisa de um com
      `DNS:Edit`, ou o Adilson cria manualmente)

### Mudança

Criar registro:
```
Tipo:  CNAME
Host:  sgtm
Valor: ghs.googlehosted.com.
TTL:   300
```

### Validação executável

```bash
dig +short sgtm.theproductengineer.net CNAME
# Esperado: ghs.googlehosted.com.
dig +short sgtm.theproductengineer.net
# Esperado: IPs do Google
```

### Rollback

Remover o registro CNAME na zona.

### Execução (append-only)

---

## Fatia 2 — Catálogo: `tenants.product-engineer`

> Satélite: onboarding `product-engineer` · Estimativa: 30 min

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |

### Pré-requisitos

- [ ] Fatia 1 não é bloqueante para esta (paralelo)
- [ ] `GA4_API_SECRET_PRODUCT_ENGINEER` gerado (ver tabela de IDs acima)

### Mudança

#### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `config/products.catalog.json` | EDIT | Adicionar bloco `tenants.product-engineer` |

#### Mudanças no catálogo

```jsonc
{
  "tenants": {
    "product-engineer": {
      "name": "The Product Engineer",
      "domains": [
        "api.theproductengineer.net",
        "theproductengineer.net"
      ],
      "allowedOrigins": ["https://theproductengineer.net"],
      "credentials": {
        "brevo_api_key_env": "BREVO_API_KEY_PRODUCT_ENGINEER",
        "replyToEmail": "contato@theproductengineer.net"
        // sem hotmart_token_env — não aplicável
      },
      "tracking": {
        "gtm": { "containerPublicId": "GTM-TK6V8G33" },
        "sgtm": { "endpointEnvVar": "SGTM_ENDPOINT_URL_PRODUCT_ENGINEER" },
        "ga4": {
          "measurementId": "G-LTQ72HWDXR",
          "measurementIdEnvVar": "GA4_MEASUREMENT_ID_PRODUCT_ENGINEER",
          "apiSecretEnvVar": "GA4_API_SECRET_PRODUCT_ENGINEER"
        }
        // sem metaCapi — decisão: sem Meta nesta fase
      },
      "dashboard": {
        "ga4": {
          "propertyIdEnv": "GA4_PROPERTY_ID_PRODUCT_ENGINEER",
          "serviceAccountKeyEnv": "GA4_SERVICE_ACCOUNT_KEY_PRODUCT_ENGINEER"
        }
        // sem metaAds — decisão: sem Meta nesta fase
      },
      "products": {
        "PRODUCT_ENGINEER_NEWSLETTER": {
          "name": "Product Engineer Field Notes",
          "tracking": {
            "productCode": "PRODUCT_ENGINEER_NEWSLETTER",
            "differentiation": {
              "produto": "PRODUCT_ENGINEER_NEWSLETTER",
              "product_code": "PRODUCT_ENGINEER_NEWSLETTER"
            }
          }
        }
      }
    }
  }
}
```

### Validação executável

```bash
cd /Users/chicoria/git/funil-mkt-platform
node -e "const c = require('./config/products.catalog.json'); console.log(Object.keys(c.tenants))"
# Esperado: ["decole", "product-engineer"]
node -e "require('./config/products.catalog.json')" && echo "JSON válido"
```

### Rollback

```bash
git revert <commit_hash>
```

### Execução (append-only)

---

## Fatia 3 — sGTM: lookup tables + publish

> Satélite: onboarding `product-engineer` · Estimativa: 1h

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |

### Pré-requisitos

- [ ] Acesso confirmado: service account `acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com`
      já é Editor na conta GTM `6381217846` (Web container do Product Engineer —
      **diferente** da conta server-side `6266094107`, que é a compartilhada
      com a DECOLE e já tem acesso confirmado)

### Mudança

1. Criar workspace novo em `accounts/6266094107/containers/241313282`
   (nome sugerido: `onboard-product-engineer-2026-10-08`)
2. Adicionar entradas:

| Lookup Table | Input | Output |
|---|---|---|
| `LT - Tenant ID by Host` | `theproductengineer.net` | `product-engineer` |
| `LT - GA4 Measurement ID by Tenant` | `product-engineer` | `G-LTQ72HWDXR` |

Sem entradas em `LT - Meta Pixel ID by Tenant/Product` nem
`LT - Meta CAPI Token by Tenant` — decisão desta fase.

3. Preview/compile check
4. **Publicar** workspace — ⚠️ toca produção compartilhada com a DECOLE;
   exige confirmação explícita do Adilson antes de executar.

### Validação executável

```bash
# Via API — confirmar entradas após publish
# GET accounts/6266094107/containers/241313282/workspaces/{published}/variables/19
# (LT - Tenant ID by Host) — confirmar entrada "theproductengineer.net"
```

### Rollback

Via UI GTM: Container > Versions > selecionar versão anterior > Publish.

### Execução (append-only)

---

## Fatia 4 — Secrets Store: secrets `_PRODUCT_ENGINEER`

> Satélite: onboarding `product-engineer` · Estimativa: 45 min

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |

### Pré-requisitos

- [ ] Token Cloudflare com escopo `Secrets Store:Edit` (hoje não confirmado —
      `CLOUDFLARE_API_TOKEN` existente pode ou não ter esse escopo, verificar
      antes de tentar)
- [ ] `GA4_API_SECRET_PRODUCT_ENGINEER` gerado

### Mudança

Secrets a criar em `default_secrets_store` (`23bdc9c2e8ca470d82352c53ec8d2e67`):

| Secret name | Binding name |
|---|---|
| `brevo_api_key_product_engineer` | `BREVO_API_KEY_PRODUCT_ENGINEER` |
| `sgtm_endpoint_url_product_engineer` | `SGTM_ENDPOINT_URL_PRODUCT_ENGINEER` |
| `ga4_measurement_id_product_engineer` | `GA4_MEASUREMENT_ID_PRODUCT_ENGINEER` |
| `ga4_api_secret_product_engineer` | `GA4_API_SECRET_PRODUCT_ENGINEER` |
| `ga4_service_account_key_product_engineer` | `GA4_SERVICE_ACCOUNT_KEY_PRODUCT_ENGINEER` |
| `ga4_property_id_product_engineer` | `GA4_PROPERTY_ID_PRODUCT_ENGINEER` |

Sem `hotmart_webhook_token_*`, `meta_capi_access_token_*`,
`meta_pixel_id_*_*` — não aplicável nesta fase.

### Validação executável

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/secrets_store/stores/23bdc9c2e8ca470d82352c53ec8d2e67/secrets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  | jq '.result[] | select(.name | contains("product_engineer")) | .name'
# Esperado: lista com os 6 secrets acima
```

### Rollback

Deletar os secrets criados via API (`DELETE .../secrets/{id}`).

### Execução (append-only)

---

## Fatia 5 — Workers: bindings + redeploy

> Satélite: onboarding `product-engineer` · Estimativa: 1h

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |

### Pré-requisitos

- [ ] Fatia 4 DONE (secrets precisam existir antes do binding)

### Mudança

#### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/funnel-dispatcher/wrangler.toml` | EDIT | Bindings `_PRODUCT_ENGINEER` |
| `workers/api-funnel-ingress/wrangler.toml` | EDIT | Bindings + nenhuma rota nova necessária (CORS por catálogo) |
| `workers/dashboard-sync/wrangler.toml` | EDIT | Só se Fatia 6 ativada |

Sem `api-hotmart-ingress` (sem Hotmart) nem `links-redirect` (sem links
curtos dedicados nesta fase).

```toml
# funnel-dispatcher/wrangler.toml — adicionar:
[[secrets_store_secrets]]
binding = "BREVO_API_KEY_PRODUCT_ENGINEER"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "brevo_api_key_product_engineer"
# ... repetir para os outros 5 secrets da Fatia 4
```

### Testes

- [ ] Rodar suite existente do worker antes de deploy: `npx vitest run`
      — confirmar 0 regressão nos testes da DECOLE antes de tocar produção

### Validação executável

```bash
cd /Users/chicoria/git/funil-mkt-platform
git add workers/funnel-dispatcher/wrangler.toml workers/api-funnel-ingress/wrangler.toml
git commit -m "feat(workers): secrets store bindings para tenant product-engineer"

export CLOUDFLARE_API_TOKEN="$(grep CLOUDFLARE_API_TOKEN .env.local | cut -d= -f2)"
npx wrangler deploy --config workers/funnel-dispatcher/wrangler.toml
npx wrangler deploy --config workers/api-funnel-ingress/wrangler.toml

npx wrangler deployments list --name decole-funnel-dispatcher | head -5
# Esperado: nova versão com timestamp recente
```

⚠️ **Redeploy toca produção compartilhada com a DECOLE — confirmação
explícita do Adilson obrigatória antes de executar.**

### Rollback

```bash
git revert <commit_hash>
npx wrangler deploy --config workers/funnel-dispatcher/wrangler.toml
npx wrangler deploy --config workers/api-funnel-ingress/wrangler.toml
# Verificar DECOLE continua OK:
curl -s https://sgtm.decolesuacarreiraesg.com.br/g/collect -o /dev/null -w "%{http_code}"
# Esperado: 400
```

### Execução (append-only)

---

## Fatia 6 — Dashboard (`mkt-dashboard`) — OPCIONAL

> Satélite: onboarding `product-engineer` · Estimativa: 30 min · **TODO só se decidido ativar**

### Status

| Campo | Valor |
|---|---|
| Estado | TODO (pendente decisão) |

### Decisão pendente

Adilson decide se quer ver métricas do Product Engineer no `mkt-dashboard`
compartilhado com a DECOLE. Se não, pular esta fatia inteira — nenhuma outra
fatia depende dela.

### Mudança (se ativada)

```bash
SENHA=$(openssl rand -base64 24)
echo "$SENHA" | npx wrangler pages secret put ADMIN_SECRET_PRODUCT_ENGINEER --project-name mkt-dashboard
echo "ADMIN_SECRET_PRODUCT_ENGINEER=$SENHA" >> /Users/chicoria/git/mkt-dashboard/.env.local
cd /Users/chicoria/git/mkt-dashboard
npx @cloudflare/next-on-pages
npx wrangler pages deploy .vercel/output/static --project-name mkt-dashboard
```

### Execução (append-only)

---

## Fatia 7 — Cloud Run: domain mapping `sgtm.theproductengineer.net`

> Satélite: onboarding `product-engineer` · Estimativa: 30 min + até 30 min propagação SSL

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |

### Pré-requisitos

- [ ] Fatia 1 DONE (CNAME propagado)

### Mudança

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"
gcloud config set project gtm-k6q4h6br-ndq3n

gcloud run domain-mappings create \
  --service server-side-tagging \
  --domain sgtm.theproductengineer.net \
  --region us-central1
```

### Validação executável

```bash
gcloud run domain-mappings describe \
  --domain sgtm.theproductengineer.net \
  --region us-central1
# Esperado (após propagação): Ready: True, CertificateProvisioned: True
```

### Rollback

```bash
gcloud run domain-mappings delete --domain sgtm.theproductengineer.net --region us-central1
```

### Execução (append-only)

---

## Fatia 8 — Smoke checklist

> Satélite: onboarding `product-engineer` · Estimativa: 30 min

### Status

| Campo | Valor |
|---|---|
| Estado | TODO |

### Pré-requisitos

- [ ] Fatias 1-5 e 7 DONE (6 é opcional)

### Validação executável

```bash
# DNS e sGTM
dig +short sgtm.theproductengineer.net CNAME
curl -s -o /dev/null -w "%{http_code}" https://sgtm.theproductengineer.net/g/collect
# Esperado: 400

# Catálogo
cd /Users/chicoria/git/funil-mkt-platform
node -e "
const c = require('./config/products.catalog.json');
const t = c.tenants['product-engineer'];
console.log('tenant:', t ? 'encontrado' : 'AUSENTE');
console.log('domains:', t?.domains);
"

# CORS do tenant
curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Origin: https://theproductengineer.net" \
  -H "Access-Control-Request-Method: POST" \
  https://api.decolesuacarreiraesg.com.br/funnel/event
# NOTA: endpoint real pode ser diferente — api-funnel-ingress não tem rota
# dedicada pro Product Engineer nesta fase (sem Fatia de rota nova), já que
# a captura de lead não passa por este worker (ver "Fora de escopo"). Esta
# verificação só é aplicável se uma fatia futura adicionar essa rota.

# Isolamento cross-tenant
grep -rE "product-engineer|product_engineer" workers/*/src/ packages/*/src/
# Esperado: 0 matches (tenant vive só no catálogo + secrets)
```

### Execução (append-only)

---

## Checklist de conclusão

```
[ ] Fatia 1: dig +short sgtm.theproductengineer.net CNAME → ghs.googlehosted.com.
[ ] Fatia 2: tenant "product-engineer" em products.catalog.json, JSON válido
[ ] Fatia 3: nova versão GTM publicada (anotar versionId: ___)
[ ] Fatia 4: secrets _PRODUCT_ENGINEER criados no Secrets Store
[ ] Fatia 5: workers redeployados com bindings _PRODUCT_ENGINEER
[ ] Fatia 6: (opcional) ADMIN_SECRET_PRODUCT_ENGINEER + mkt-dashboard redeployado
[ ] Fatia 7: Cloud Run domain mapping Ready=True
[ ] Fatia 8: smoke checklist completo
```

## Gotchas / lições aprendidas

- (preencher durante a execução)

## Decisões tomadas (delta vs runbook original)

- Sem `hotmart_token_env`, sem produtos pagos — primeiro tenant do runbook
  sem Hotmart. Runbook original assume Hotmart presente; confirmar que
  `funnel-dispatcher` não quebra com `credentials.hotmart_token_env`
  ausente (pode exigir ajuste de código — se sim, registrar aqui e
  retroalimentar o runbook).
- Sem Meta Pixel/CAPI — primeiro tenant do runbook inteiramente sem Meta.
  Runbook original sempre inclui entradas Meta no exemplo; aqui testamos
  o caminho "tenant sem Meta" descrito na conversa original (tag não
  dispara por lookup vazio) — vale confirmar na Fatia 8 que isso não
  gera erro silencioso no worker.
