# Plano Satélite 2 — sGTM Único da Plataforma (Modelo B)

> **Satélite** de [`PLANO-MASTER-MULTI-TENANT.md`](../PLANO-MASTER-MULTI-TENANT.md) (Slice 2.11B)
> **Pode rodar em paralelo** com 2.11A (não há dependência forte)
> **Pré-requisito:** acesso a Cloud Run no projeto GCP `gtm-k6q4h6br-ndq3n`; service account `acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com` (credentials em `~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json`)

---

## 1. Objetivo

Transformar o sGTM em **infra compartilhada da `funil-mkt-platform`** — 1 container Cloud Run que serve todos os tenants, com custom domains por tenant preservando first-party cookies. Onboarding de novo tenant = DNS + lookup table + secrets, sem nova instância de container.

## 2. Decisão e racional

Modelo B escolhido sobre:
- **Modelo A (sGTM por tenant):** 1 container por tenant. Isolamento total mas custo e operação N×. Cada onboarding exige novo projeto GCP + container + config.
- **Modelo C (1 domínio único `sgtm.funilmkt.io` para todos):** REJEITADO por quebrar first-party cookies em Safari/iOS. Cookies emitidos por domínio do platform não funcionam como first-party para os tenants.

**Vantagens do Modelo B:**
- 1 container para versionar/operar/monitorar
- Custo agregado menor (Cloud Run autoscale serve todos)
- Onboarding de tenant = DNS CNAME + entrada na lookup table + secrets no catálogo (zero container novo)
- First-party cookies preservados (cada tenant vê seu próprio subdomínio)

**Critério:** tenants compartilham infra, mas cada um vê seu próprio subdomínio.

## 3. Arquitetura alvo

- **Container:** imagem oficial `gcr.io/cloud-tagging-10302018/gtm-cloud-image` em Cloud Run (mantém atual; migração para DigitalOcean fica parqueada — ver seção 8)
- **Domínios (custom domain mapping no Cloud Run):**
  - `sgtm.decolesuacarreiraesg.com.br` (DECOLE — já existe)
  - `sgtm.superare.com.br` (SUPERARE — adicionar quando onboardar)
  - Ambos apontam para a mesma instância Cloud Run
- **Preview server:** 1 instância separada (`sgtm-preview.funilmkt.io` ou similar) para debug GTM
- **Logging:** Cloud Logging com label `tenant_id` injetado via custom variable

## 4. Lookup tables no container sGTM (config interna)

- Variável "Tenant ID" lendo do **hostname do request** (Header `Host`) → mapeia `sgtm.decolesuacarreiraesg.com.br` → `decole`, `sgtm.superare.com.br` → `superare`
- Variável "Produto" lendo do payload (`event_params.produto`)
- Lookup tables versionadas no workspace GTM (não em código):
  - `tenant_id → GA4 Measurement ID`
  - `tenant_id → GA4 API Secret`
  - `tenant_id → Meta CAPI Access Token`
  - `(tenant_id, produto) → Meta Pixel ID`
- **Decisão sobre api_secret GA4:** worker continua injetando via query string (catalog é fonte de verdade, rotação simples). sGTM apenas repassa. Lookup tables internas são fallback para casos onde o worker não conhece o secret (ex: requests direto do GTM Web sem passar por worker).

## 5. Migração do sGTM atual para Modelo B

- **Passo 1:** auditar config atual do container DECOLE — confirmar instância única, identificar tags (GA4, Meta CAPI, outras), levantar variáveis e secrets hoje hardcoded → **slice 2.11B.1**
- **Passo 2:** refatorar workspace GTM atual para usar lookup tables (tag GA4 lê measurement_id de variável dinâmica baseada em tenant_id; tag Meta CAPI idem para pixel_id e access_token) → **slice 2.11B.2** (em PREVIEW)
- **Passo 3:** validar com **tenant fake "superare-test"** em ambiente preview — request com Host header `sgtm.superare-test.com.br`, payload com `tenant_id=superare-test` — confirmar que lookup retorna config correta e tag dispara para destinos certos → **slice 2.11B.3**
- **Passo 4:** deploy do container atualizado (apenas Cloud Run, sem mexer em workers) → **slice 2.11B.4**
- **Passo 5:** smoke E2E real com DECOLE — confirmar que nada quebrou
- Janela: 1 semana com folga para testes

### 5.1 Estado confirmado em 2.11B.2 (2026-05-18)

**Cloud Run / domínio**
- Projeto GCP: `gtm-k6q4h6br-ndq3n`
- Região ativa: `us-central1`
- Serviços encontrados: `server-side-tagging` e `server-side-tagging-preview`
- Domain mapping: `sgtm.decolesuacarreiraesg.com.br` → `server-side-tagging`
- Estado do domínio: `Ready=True`, `CertificateProvisioned=True`, `DomainRoutable=True`
- DNS: `sgtm.decolesuacarreiraesg.com.br CNAME ghs.googlehosted.com.`

**GTM server-side**
- Account: `6266094107`
- Container server-side: `GTM-K6Q4H6BR` (`containerId=241313282`)
- Workspace criado para o slice: `codex-2.11B.2-multitenant-preview` (`workspaceId=24`)
- Não houve publish de versão; o workspace foi apenas compilado com `quick_preview`.

**Refactor aplicado no workspace 24**
- Variáveis base:
  - `RH - Host` (`Request Header`, header `host`)
  - `ED - produto` (`Event Data`, key path `produto`)
  - `ED - test_event_code` (`Event Data`, key path `test_event_code`)
- Lookup tables:
  - `LT - Tenant ID by Host`
  - `LT - GA4 Measurement ID by Tenant`
  - `LT - Meta CAPI Token by Tenant`
  - `LT - Meta Pixel ID by Tenant/Product`
  - `LT - Meta Test Event Code by Tenant/Product`
- Tags:
  - `GA4` usa `{{LT - GA4 Measurement ID by Tenant}}`
  - `Meta CAPI - Dynamic by Tenant/Product` usa lookup de pixel/token/test code
- A tag Meta estática duplicada do pixel PlanoVoo foi removida apenas do workspace 24.

**Ressalvas para 2.11B.3**
- Existe um workspace preexistente `codex-mp-routing-1777296276501` (`workspaceId=17`) que não foi tocado.
- O workspace 24 inclui linhas placeholder para `superare-test` apenas para preview/validação; não estão publicadas.
- A validação do envio real para GA4/Meta em preview fica para 2.11B.3.

## 6. Onboarding de novo tenant (runbook)

(Esse runbook macro vai virar `RUNBOOK-ONBOARDING-TENANT.md` no slice 2.11B.5)

1. Adicionar entrada no DNS: `sgtm.{tenant_domain}` CNAME → host Cloud Run (ou registrar custom domain no Cloud Run)
2. Adicionar entrada nas lookup tables do container sGTM (workspace GTM): `tenant_id`, GA4 IDs, Meta CAPI token, pixel IDs por produto
3. Publicar nova versão do workspace
4. Adicionar `tenants.{id}.tracking.sgtm.endpointEnvVar` no catálogo da `funil-mkt-platform` apontando para o novo domínio
5. Criar secret `SGTM_ENDPOINT_URL_{TENANT}` nos workers (via Secrets Store)
6. Criar secret `ADMIN_SECRET_{TENANT_UPPERCASE}` no Cloudflare Pages (`decole-dashboard`) — senha de acesso ao dashboard para este tenant:
   ```bash
   echo "SENHA_DO_TENANT" | wrangler pages secret put ADMIN_SECRET_{TENANT_UPPERCASE} --project-name decole-dashboard
   ```
   Salvar também em `.env.local` como `ADMIN_SECRET_{TENANT_UPPERCASE}=SENHA_DO_TENANT`.
   Redeploy do `mkt-dashboard` para ativar o novo secret.
7. Smoke E2E com test event
8. Smoke login dashboard: tenant={tenant_id}, senha=ADMIN_SECRET_{TENANT_UPPERCASE} → redireciona para /dashboard

## 7. Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| 1 | **Noisy neighbor:** tráfego pico de um tenant pode afetar outros | Cloud Run autoscale (min/max instances), monitoring de latência por tenant_id, alertas P95 |
| 2 | **Misconfig de lookup:** entrada errada manda evento de DECOLE para property GA4 de SUPERARE | Testes E2E automatizados com `test_event_code` por tenant; lookup tables versionadas (rollback de 1 click) |
| 3 | **Compliance / SLA exclusivo:** tenant futuro pode exigir isolamento contratual | Documentar exception flow — esse tenant ganha container Cloud Run próprio, lookup table interna só com aquele tenant |
| 4 | **Single point of failure:** queda do container afeta TODOS os tenants | Cloud Run multi-region failover, health checks, alertas pagerduty |
| 5 | **Onboarding requer mudança no container:** não é instantâneo via catálogo manual | **Curto prazo:** script `scripts/onboard-tenant-sgtm.sh` que gera diff de lookup table a partir do catálogo. **Médio prazo (ver seção 10):** automação via APIs reusando SA existente |

## 8. Decisões parqueadas

- **Provedor de infra:** Cloud Run hoje; migração para DigitalOcean App Platform fica em backlog (gatilho: custo, consolidação com VPS Plano de Voo). Mudança transparente para workers (só DNS muda).
- **Reescrita em Cloudflare Workers:** parqueada. Gatilho: intenção estratégica de eliminar dependência externa total. Esforço alto (3-6 sprints). A `funil-mkt-platform` já tem ~60% do necessário (GA4 MP em emit_tracking, dedup, catálogo, queue). Faltaria: Meta CAPI handler, cookie emission first-party, compatibilidade com protocolo Google Tag client.

## 9. Definition of Done

- 1 container Cloud Run aceita requests dos custom domains de cada tenant configurado
- Lookup tables internas mapeiam tenant_id/produto para destinos corretos (validado via test events)
- DECOLE em produção continua funcionando sem regressão de tracking
- Runbook de onboarding documentado e testado com tenant fake
- Monitoring expõe latência e error rate por tenant_id

## 10. Roadmap: Onboarding automatizado via APIs (não bloqueante para 2.11B)

**Insight de habilitação:** a service account `acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com` (credentials em `~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json`, hoje usada em `decole/decolesuacarreiraesg/.env.local`) está no **mesmo projeto GCP do container sGTM**. Provavelmente já tem as roles necessárias para automação. Verificar com:

```bash
gcloud projects get-iam-policy gtm-k6q4h6br-ndq3n \
  --flatten="bindings[].members" \
  --filter="bindings.members:acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com"
```

Isso elimina a barreira "criar SA nova" — a fundação está pronta.

**APIs envolvidas no fluxo de onboarding automatizado:**

1. **Cloud Run Admin API** (`run.googleapis.com/apis/domains.cloudrun.com/v1/`)
   - `domainmappings.create` adiciona `sgtm.{tenant_domain}` ao container
   - SSL Google-managed auto-emitido após validation (15-30min)
   - Role: `roles/run.developer`
2. **Tag Manager API v2** (`tagmanager.googleapis.com/tagmanager/v2/`)
   - `variables.update` adiciona linha nas lookup tables (tenant_id → measurement_id, api_secret, pixel_id, capi_token)
   - `versions.create + publish` ativa mudanças
   - Permissão: SA precisa ser adicionada como **User no GTM account** (sistema de permissões próprio do GTM, separado do IAM — passo manual único)
3. **Cloudflare API** (`api.cloudflare.com/client/v4/accounts/{id}/workers/scripts/{worker}/secrets`)
   - Cria `SGTM_ENDPOINT_URL_{TENANT}` (e demais secrets `_TENANT`) nos workers
   - Token Cloudflare separado com escopo `Workers Scripts:Edit` + `Secrets Store:Edit`

**Fluxo proposto (executado pela app dashboard como backoffice):**

1. Operador preenche form: tenant name, domínio raiz, GA4 IDs, Meta Pixel IDs por produto, etc.
2. App valida schema do catálogo + cria PR (ou commit direto via GitHub API) no `funil-mkt-platform/config/products.catalog.json`
3. Jobs paralelos:
   - Cloud Run: adiciona domain mapping para `sgtm.{tenant_domain}` (poll SSL ready)
   - Tag Manager: atualiza lookup tables + publish version
   - Cloudflare: cria secrets `*_TENANT` nos workers via API
4. Mostra instrução manual ao operador: "criar CNAME `sgtm.{tenant_domain}` → `ghs.googlehosted.com` no DNS do tenant" (passo que sempre exige ação do tenant — não automatizável)
5. Smoke E2E automático: envia test event para `sgtm.{tenant_domain}` com test_event_code do tenant; valida chegada no GA4 + Meta CAPI
6. Status "ready" no backoffice

**Limitações honestas:**
- **DNS do tenant é sempre manual** (vocês não controlam o DNS deles)
- **SSL provision não é síncrono** — backoffice precisa job assíncrono com polling/notification
- **GTM publish é sensível** — convenção: backoffice mostra diff e exige aprovação humana antes do `versions.publish`
- **App dashboard hoje só lê métricas** — virar backoffice de onboarding é trabalho de 4-8 sprints (UI + jobs + auth). Repo separado (`decole-dashboard`), fora do escopo do `funil-mkt-platform`

**Conclusão:** este roadmap NÃO é slice de 2.11B. É visão de produto para quando houver clareza de prioridade. Mas vale documentar aqui porque a fundação técnica (SA, container Cloud Run, catálogo declarativo) já está pronta — o trabalho é principalmente de UI/UX de backoffice, não de infra nova.
