# Arquitetura de Componentes — Onboarding de Tenant

> Documento de referência (não é plano nem runbook): destila **todo
> componente/artefato** necessário pra operar um tenant end-to-end no
> `funil-mkt-platform`, **onde cada um vive**, e como se relacionam.
> Companion a [`RUNBOOK-ONBOARDING-TENANT.md`](./RUNBOOK-ONBOARDING-TENANT.md)
> (passo-a-passo) e `plans/onboardings/{tenant}-{date}.md` (execução real).
> Atualizar sempre que um onboarding real revelar um componente não mapeado
> aqui (ver "Gotchas" do onboarding correspondente).

## Diagrama geral

```text
Browser (site do tenant, ex: theproductengineer.net)
│
├── GTM Web Container (Google Tag Manager — conta PRÓPRIA do tenant,
│   ex: GTM-TK6V8G33 / account 6381217846)
│   └── tag "Google tag" (GA4 Config)
│       Server Container URL → sGTM compartilhado (ver abaixo)
│
└── Form de lead/precheckout
    ├── JS genérico (reutilizável entre tenants):
    │   UTM capture/persist, lead_id/session_id, leitura de token
    │   Turnstile, loading state, mapeamento de erro amigável
    ├── JS específico do tenant: validação de campos, Meta Advanced
    │   Matching (se houver Meta Pixel), handler de submit inline
    └── action = URL do backend que recebe o POST:
        ├── Worker dedicado do funil-mkt-platform (api-precheckout /
        │   api-funnel-ingress) — padrão DECOLE, tenant já no catálogo
        └── OU Cloudflare Pages Function própria do site — padrão pra
            tenant que não quer entrar no catálogo multi-tenant
            compartilhado (ex: Product Engineer, Caminho A)

                    ▼ (eventos de dataLayer/browser, independente do form)
┌─────────────────────────────────────────────────────────────────────┐
│ sGTM Server Container — Google Cloud Run, COMPARTILHADO entre        │
│ tenants (GTM-K6Q4H6BR / account 6266094107 / container 241313282)    │
│                                                                        │
│  Lookup tables (por workspace, precisa publish pra ir pra produção): │
│    LT - Tenant ID by Host          (host → tenant_id)                │
│    LT - GA4 Measurement ID by Tenant                                  │
│    LT - Meta Pixel ID by Tenant/Product   (opcional)                 │
│    LT - Meta CAPI Token by Tenant          (opcional)                │
│    LT - Meta Test Event Code by Tenant/Product (opcional)            │
│                                                                        │
│  Clients: GA4 (gaaw_client), GA4 MP (mpaw_client)                     │
│  Tags: GA4 (sgtmgaaw) — sempre dispara;                               │
│        Meta CAPI (custom template cvt_NCN6S) — só dispara se as      │
│        lookup tables de Meta tiverem entrada pro tenant               │
│                                                                        │
│  Domain mapping no Cloud Run, UM POR TENANT:                          │
│    sgtm.{tenant_domain} → ghs.googlehosted.com (CNAME DNS do tenant   │
│    + gcloud run domain-mappings create) — exigido pra cookies        │
│    first-party no domínio do tenant                                  │
└─────────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
              GA4 Measurement Protocol    Meta Conversions API
              (property do tenant)        (pixel do tenant, se houver)


┌─────────────────────────────────────────────────────────────────────┐
│ Cloudflare Workers (funil-mkt-platform, repo COMPARTILHADO)           │
│                                                                        │
│  api-hotmart-ingress   — webhooks Hotmart (só se tenant tem checkout) │
│  api-funnel-ingress    — eventos de browser/app (lead, begin_checkout)│
│  api-precheckout       — lead capture → DOI nativo Brevo              │
│  funnel-dispatcher     — consome a queue, executa chain por evento    │
│  links-redirect        — redirects de checkout, emite BEGIN_CHECKOUT  │
│  dashboard-sync        — alimenta o mkt-dashboard (opcional)          │
│                                                                        │
│  Todos leem `config/products.catalog.json` pra resolver tenant por    │
│  hostname (resolveTenantFromHostname — código genérico, funciona pra  │
│  qualquer tenant presente no catálogo, sem mudança de código)         │
│                                                                        │
│  Credenciais: Cloudflare Secrets Store (store_id                      │
│  23bdc9c2e8ca470d82352c53ec8d2e67), um secret por {nome}_{TENANT},    │
│  bindado explicitamente no wrangler.toml de cada worker               │
│                                                                        │
│  Estado compartilhado entre TODOS os tenants: queue                   │
│  decole-q-funnel-events, D1 (IDENTITY_DB, EVENT_STORE_DB), KV          │
│  (IDENTITY_KV, DEDUPE_KV) — dados de tenants diferentes convivem no   │
│  mesmo banco/queue, isolados só pela coluna/campo tenant_id            │
└─────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
              Brevo (conta POR TENANT, separada)
              Lista + templates DOI/transacional
              "managedVia: manual_dashboard" — SEM API de automação
              (confirmado: endpoints automation/automations/workflows
              retornam 404; só contacts/lists/templates são API-managed)


┌─────────────────────────────────────────────────────────────────────┐
│ Governança / Claude Code (fora do funil-mkt-platform)                 │
│ ~/.claude/settings.json → permissions.autoMode.allow                  │
│ Pré-autorizações em linguagem natural (não glob/regex), uma por       │
│ cenário — ex: ler a service-account key pra consultar GTM read-only.  │
│ Ações sensíveis sem entrada aqui (escrita no Secrets Store, leitura    │
│ bruta de JSON de credencial) são bloqueadas por um classificador      │
│ separado até o humano adicionar a entrada correspondente.             │
└─────────────────────────────────────────────────────────────────────┘
```

## Tabela de artefatos — onde cada coisa vive

| Artefato | Tipo | Onde vive | Gerenciado por | Compartilhado entre tenants? |
|---|---|---|---|---|
| GTM Web Container | Config Google | console GTM (conta própria do tenant) | Operador (API ou UI) | **Não** — 1 por tenant |
| sGTM Server Container | Config Google + Cloud Run | `GTM-K6Q4H6BR`, account `6266094107` | Operador (API) | **Sim** — todos os tenants |
| Cloud Run service `server-side-tagging` | Infra GCP | projeto `gtm-k6q4h6br-ndq3n`, região `us-central1` | Operador (gcloud) | **Sim** — 1 service, N domain mappings |
| Domain mapping Cloud Run | Infra GCP | 1 por tenant (`sgtm.{domain}`) | Operador (gcloud) | **Não** — 1 por tenant |
| DNS CNAME `sgtm.{domain}` | DNS | zona Cloudflare do tenant | Tenant/operador (API Cloudflare) | **Não** — 1 por tenant |
| GA4 Account + Property | Config Google | console GA4 (conta própria do tenant) | Operador/tenant | **Não** — 1 por tenant |
| `GA4_API_SECRET` (Measurement Protocol) | Secret | gerado via GA4 Admin API, após "User Data Collection Acknowledgement" manual | Operador (API, após clique manual do dono da property) | **Não** — 1 por tenant |
| `products.catalog.json` | Config/código | `funil-mkt-platform/config/products.catalog.json` | Operador (commit) | **Sim** — 1 arquivo, N blocos `tenants.{id}` |
| Workers (`api-funnel-ingress` etc.) | Código/infra | `funil-mkt-platform/workers/*/wrangler.toml` + Cloudflare | Operador (deploy) | **Sim** — mesmo código/deploy pra todos |
| Secrets Store entries | Secret | Cloudflare Secrets Store `23bdc9c2e8ca470d82352c53ec8d2e67` | Operador (API) | **Não** — 1 secret por `{nome}_{tenant}` |
| `ADMIN_SECRET_{TENANT}` | Secret | Cloudflare **Pages** secret (projeto `mkt-dashboard`) — loja diferente do Secrets Store de Workers | Operador | **Não** — 1 por tenant, opcional |
| Conta Brevo | Config externa | painel Brevo (conta separada por tenant) | Tenant/operador (manual) | **Não** — 1 por tenant |
| `precheckout.js` / `meta-am.js` | JS compartilhado | `decolesuacarreiraesg/site/assets/*.js` (repo da DECOLE — não está no funil-mkt-platform) | Time do site | Hoje só existe pro site da DECOLE — não é um pacote compartilhado de verdade |
| Handler de submit do form | JS inline | dentro do `index.html` de cada site, não em arquivo compartilhado | Time do site | **Não** — duplicado por site |
| Pages Function (captura de lead, Caminho A) | Código | repo do site do tenant (`sites/{tenant}/functions/`) | Operador | **Não** — 1 por tenant que optar por esse caminho |
| Plano de onboarding (fatias) | Doc | `funil-mkt-platform/plans/onboardings/{tenant}-{data}.md` | Operador | **Não** — 1 por tenant |
| Pré-autorizações de permissão | Config | `~/.claude/settings.json` → `permissions.autoMode.allow` | Humano (Adilson) | Global à máquina, não por tenant |

## JS de formulário — o que é genérico vs. específico

A DECOLE **não tem** um pacote JS compartilhado de verdade entre sites hoje
— `precheckout.js` e `meta-am.js` vivem dentro do próprio repo do site da
DECOLE (`decolesuacarreiraesg/site/assets/`), não em `funil-mkt-platform`
nem em nenhum lugar reusável por outros tenants sem copiar o arquivo.

| Pedaço | Genérico (reaproveitável) | Específico do tenant |
|---|---|---|
| Captura/persistência de UTM | ✅ | — |
| `lead_id` / `session_id` (sessionStorage) | ✅ | — |
| Leitura de token Turnstile | ✅ | — |
| Loading state do botão | ✅ | — |
| Mapeamento de erro amigável (resposta Brevo) | ✅ | — |
| Validação de telefone BR | ❌ | Só serve pra tenants BR |
| Meta Advanced Matching (`meta-am.js`) | ❌ (opcional) | Só se o tenant tiver Meta Pixel |
| `dataLayer.push` dos eventos (`generate_lead`, `begin_checkout`) | Estrutura genérica, nomes de evento específicos do produto | Específico (nomes de produto no payload) |
| `form.action` (URL do backend) | — | **Sempre específico**: Worker do catálogo (tenant já onboardado) ou Pages Function própria |

**Não existe hoje** um pacote `@funil-mkt/form-utils` ou equivalente — se
um segundo tenant (Product Engineer) quiser reusar esses utilitários, a
opção mais simples nesta fase é **copiar e adaptar** o arquivo (cortando a
parte BR-específica), não importar de um pacote compartilhado — criar esse
pacote seria trabalho de engenharia novo, fora do escopo de qualquer
onboarding individual.

## Relação com os demais documentos

- [`RUNBOOK-ONBOARDING-TENANT.md`](./RUNBOOK-ONBOARDING-TENANT.md) — o
  passo-a-passo operacional, 8 frentes, com os comandos exatos.
- `plans/onboardings/{tenant}-{date}.md` — a execução real de um
  onboarding específico, com status/execução por fatia (ex:
  `plans/onboardings/product-engineer-2026-10-08.md`).
- Este arquivo — o mapa de **o que existe e onde vive**, atualizado quando
  um onboarding real descobre algo que o runbook não previa (ex: a
  exigência do "User Data Collection Acknowledgement" manual na GA4, ou o
  fato de `precheckout.js` não ser de fato compartilhável sem cópia
  manual — ambos descobertos no onboarding do Product Engineer).

## Correção de rumo: a captura de lead usa o pipeline completo, não uma Function isolada

Durante o onboarding do `product-engineer` o plano inicial assumiu que a
captura de lead passaria por uma **Cloudflare Pages Function isolada**
chamando a Brevo direto (o desenho do "Caminho A", leve, sem tocar o
`funil-mkt-platform`). O Adilson corrigiu: num onboarding **completo**, o
fluxo é o mesmo da DECOLE — form do site → `api.{domínio}/funnel/*`
(`api-funnel-ingress`) → queue → `funnel-dispatcher` → Brevo DOI. Isso
muda o diagrama geral: o nó "Pages Function própria" descrito antes como
alternativa ao Worker compartilhado só se aplica ao Caminho A (leve); no
Caminho B (este documento), a captura de lead **sempre** passa pelo
pipeline compartilhado, exigindo a rota `/funnel/*` + DNS placeholder
descritos na tabela de artefatos.

## Brevo — peças que faltavam na primeira passada do runbook

O `RUNBOOK-ONBOARDING-TENANT.md` original não menciona isso explicitamente
(a DECOLE já tinha tudo criado antes do runbook existir). Pra um tenant
novo de verdade, antes do `funnel-dispatcher` conseguir rodar a chain de
`GENERATE_LEAD`, precisa existir na conta Brevo do tenant:

| Peça | Como criar | Formato real confirmado |
|---|---|---|
| Atributos de contato de funil | `POST /v3/contacts/attributes/{categoria}/{nome}` — **atenção:** o segmento da URL é a *categoria* (`normal`, etc.), não o *tipo* (`text`/`date`) | `{PREFIX}_FUNIL_STEPS` (text), `{PREFIX}_FUNIL_LAST_STEP` (text), `{PREFIX}_FUNIL_LAST_STEP_TIMESTAMP` (date) |
| `LEAD_ID` | mesmo endpoint, `category=normal`, `type=text` | Não existe por padrão numa conta Brevo nova — precisa criar |
| Lista de precheckout | `POST /v3/contacts/lists` | Retorna só `{"id": N}` |
| Template DOI | `POST /v3/smtp/templates` | Exige um `sender.email` que já seja um **sender verificado** na conta (`GET /v3/senders` pra confirmar antes de tentar). **Precisa de `"tag": "optin"`** (`PUT /v3/smtp/templates/{id}` com `{"tag": "optin"}`) — teste real mostrou o envio falhar silenciosamente sem isso; ver nota abaixo, causalidade correlacionada mas não confirmada por log |

**Limite de caracteres no nome do atributo:** o `funnelPrefix` do
catálogo (`{TENANT}_{PRODUTO}`) pode facilmente exceder o limite da Brevo
quando concatenado com `_FUNIL_LAST_STEP_TIMESTAMP`. Testar o nome
completo antes de assumir que vai funcionar — a DECOLE usa prefixos
curtos (`DECOLE_ESG`, `DECOLE_PLANOVOO`) que nunca bateram nesse limite;
um tenant com nome de produto mais longo (`PRODUCT_ENGINEER_NEWSLETTER`)
bate. (Fonte: onboarding `product-engineer`, Fatia 2b.)

## Workers Routes exigem o hostname existir na zona

Adicionar `"api.{tenant_domain}/funnel/*"` ao `routes` do
`api-funnel-ingress` **não basta** — Cloudflare recusa a rota (ou o
tráfego nunca chega no Worker) se o hostname não tiver nenhum registro
DNS na zona, mesmo sem origem real por trás. Fix: criar um registro
placeholder (`A → 192.0.2.1`, proxied/orange-cloud) só pra satisfazer essa
exigência — o Worker intercepta no edge antes de qualquer tentativa de
resolver a origem. (Fonte: onboarding `product-engineer`, Fatia 5.)

## Escopos OAuth da Tag Manager API — não são intuitivos

`create_version` (CreateContainerVersion) exige o escopo
`tagmanager.edit.containerversions` — **não** `tagmanager.edit.containers`
(esse serve pra editar tags/triggers/variáveis dentro de um workspace, uma
operação diferente). `:publish` usa `tagmanager.publish`. Testar cada
escopo contra a operação real antes de assumir que um escopo "parecido"
serve — os nomes sugerem hierarquia que não existe de fato. (Fonte:
onboarding `product-engineer`, Fatia 3.)

## Turnstile — nenhum tenant validava server-side até este onboarding

Confirmado via `grep -rn "turnstile\|siteverify" workers/ packages/shared/`
→ 0 matches antes desta mudança: **nenhum worker do `funil-mkt-platform`
chamava a API `siteverify` da Cloudflare**, nem pra DECOLE. O token era
coletado no browser (`cf-turnstile-response`) e repassado ao backend, mas
nunca verificado — proteção zero na prática, só fricção de UI.

Implementado pro `product-engineer` (primeiro tenant): `verifyTurnstile()`
em `api-funnel-ingress/src/index.ts`, opt-in via binding
`TURNSTILE_SECRET_KEY_{TENANT}`. Tenant sem esse binding = sem validação,
comportamento idêntico a antes — nenhuma mudança de código quebra DECOLE.
Pra ativar em outro tenant: criar o widget Turnstile, criar o secret
`turnstile_secret_key_{tenant}` no Secrets Store, bindar no
`wrangler.toml`, redeploy. Nenhuma mudança de código adicional necessária.

**Criar widgets Turnstile via API falhou com os tokens existentes** —
`403 Authentication error`, não é bloqueio do harness, é escopo
`Turnstile:Edit` ausente nos tokens, e esse grupo de permissão nem aparece
no seletor de criação de token customizado da Cloudflare hoje. Criar
widget novo = painel (Security → Turnstile → Add widget), não API, até
isso mudar.

## Gotchas consolidados (vindos de onboardings reais)

- GA4 exige "User Data Collection Acknowledgement" manual (clique no
  painel) antes de criar Measurement Protocol secrets via API — não tem
  como automatizar esse clique. (Fonte: onboarding `product-engineer`,
  Fatia 4.)
- `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_API_READALL_TOKEN` falham no
  endpoint genérico `/user/tokens/verify` mesmo quando têm escopo válido
  pra operações reais — não usar esse endpoint pra decidir se um token
  funciona; testar contra uma chamada real e específica. `CLOUDFLARE_AGENTS_AI_TOKEN`
  confirmado funcionando pra DNS write e Secrets Store read (write ainda
  não confirmado — bloqueado por permissão do harness, não pelo token).
  (Fonte: onboarding `product-engineer`, Fatias 1 e 4.)
- `workerViews` em `products.catalog.json` é só documentação descritiva —
  nenhum código lê esse campo. Não é obrigatório atualizar pra um tenant
  novo funcionar, só por completude. (Fonte: onboarding `product-engineer`,
  Fatia 2.)
- Domain mapping no Cloud Run exige o domínio **verificado no Google
  Search Console** antes (`gcloud domains verify {domínio raiz}`) — passo
  interativo via browser, atrelado à conta Google do dono do domínio, não
  documentado no runbook original (a DECOLE provavelmente já tinha o
  domínio verificado de alguma integração anterior, por isso nunca
  apareceu como passo explícito). Verificar o domínio raiz, não o
  subdomínio `sgtm.*` — a verificação cobre todos os subdomínios de uma
  vez. **Mais importante:** a verificação é por *identidade* — fica
  associada à conta Google usada no browser durante `gcloud domains
  verify`. Se o `gcloud` CLI estiver autenticado como a service account
  (uso normal pra GTM/GA4/Secrets Store), ela não "vê" domínios
  verificados pela conta pessoal do humano. Fix: `gcloud auth login` com
  a conta pessoal só pra rodar `domain-mappings create`, depois `gcloud
  config set account {service-account}` de volta. (Fonte: onboarding
  `product-engineer`, Fatia 7.)
- `gcloud` CLI não vinha instalado nesta máquina. Homebrew cask
  (`google-cloud-sdk`) falhou por erro de cache interno do Homebrew (não
  relacionado ao gcloud); instalado via tarball oficial
  (`google-cloud-cli-darwin-{arch}.tar.gz` de
  `dl.google.com/dl/cloudsdk/channels/rapid/downloads/`) + `install.sh
  --quiet --path-update=false`. Checar `uname -m` antes de baixar —
  existe build `-arm` e `-x86_64` separados. O comando `domain-mappings`
  pra Cloud Run *fully managed* vive em `gcloud beta run
  domain-mappings`, não no grupo padrão `gcloud run domain-mappings`
  (esse é só pra "Cloud Run for Anthos"/GKE). (Fonte: onboarding
  `product-engineer`, Fatia 7.)
- Brevo não expõe criação/edição de automações via API (só contacts,
  lists, templates, campaigns, e o endpoint `/v3/events` pra *disparar*
  uma automação já montada manualmente). Confirmado com teste real contra
  a API, não só pela documentação. (Fonte: sessão de planejamento do lead
  magnet do Product Engineer.)
