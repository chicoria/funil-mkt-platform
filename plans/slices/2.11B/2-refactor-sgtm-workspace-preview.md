# Slice 2.11B.2 — Refatorar sGTM em PREVIEW

> Satélite: 2.11B ([`../../completed/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](../../completed/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 20:17 WEST por Codex |
| Completed | 2026-05-18 20:29 WEST por Codex |
| Commit final | `e115f92` |
| PR | — |
| Janela de smoke | N/A — PREVIEW, sem publish produção |

## Contexto

O sGTM atual serve DECOLE e ainda precisa ser preparado para o Modelo B: um container compartilhado com roteamento por tenant/produto. Esta slice trabalha apenas no workspace/preview do container server-side `GTM-K6Q4H6BR`, criando ou preparando variáveis/lookup tables dinâmicas sem publicar versão em produção.

## Pré-requisitos

- [x] 2.11B.1 DONE — inventário baseline do sGTM DECOLE
- [x] 2.11A.3 DONE — dispatcher resolve tracking por tenant e envia payload preservando `produto`
- [x] Service account local existe em `~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json`
- [x] Service account com acesso suficiente ao Tag Manager API/container server-side

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `plans/slices/2.11B/2-refactor-sgtm-workspace-preview.md` | CREATE/EDIT | Registro executável da slice, lacunas, decisões e validações |
| `plans/STATUS-2.11.md` | EDIT | Marcar slice em progresso/concluída ou bloqueada |
| `plans/PLANO-MASTER-MULTI-TENANT.md` | EDIT | Atualizar cabeçalho ao fechar |
| `plans/completed/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md` | EDIT | Atualizar descobertas reais se houver delta do plano |
| GTM workspace `GTM-K6Q4H6BR` | EXTERNAL | Refactor em workspace/preview, sem publicar produção |

### Diff conceitual

```text
Antes:
- sGTM seleciona destinos para DECOLE a partir da configuração existente, possivelmente por lookup só de produto ou valor estático.

Depois:
- Variável Tenant ID: hostname/request Host -> tenant_id.
- Lookup tenant_id -> GA4 Measurement ID.
- Lookup tenant_id -> GA4 API Secret ou passthrough da query string quando o worker envia api_secret.
- Lookup tenant_id -> Meta CAPI Access Token.
- Lookup tenant_id + produto -> Meta Pixel ID.
- Workspace fica pronto para preview/validação com tenant fake em 2.11B.3, sem publish produção.
```

### Mudanças no catálogo

Não previstas. O catálogo já contém `tenants.decole.tracking` e `tenants.decole.products.*.tracking.metaPixel`.

## Testes

### Unit

N/A — esta slice muda configuração externa do GTM, não código local de worker.

### E2E/Preview

- [x] Tag Manager API consegue ler conta/container/workspaces.
- [x] Workspace server-side correto identificado (`GTM-K6Q4H6BR`, account `6266094107`).
- [x] Config atual exportada/inspecionada antes de qualquer mutação.
- [x] Refactor aplicado em workspace não publicado.
- [x] Diff/preview mostra variáveis de tenant/produto dinâmicas e preserva DECOLE.

## Validação executável

```bash
# 1. Verificar DNS do domínio sGTM atual
dig +short sgtm.decolesuacarreiraesg.com.br CNAME

# 2. Verificar acesso Tag Manager API com service account
node <script one-off de leitura Tag Manager API>

# 3. Validar JSON do catálogo se houver alteração
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"

# 4. Verificar diff local
git diff --check
```

## Smoke checklist

- [x] Nenhuma versão publicada no GTM.
- [x] Nenhum deploy Cloud Run.
- [x] Workspace preview preparado para validação do 2.11B.3.

## Rollback

Se houver mutação no workspace GTM:

```bash
# Via GTM UI/API: descartar as mudanças do workspace de preview ou restaurar snapshot/export anterior.
```

Se houver apenas documentação local:

```bash
git revert <commit_hash>
```

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

### 2026-05-18 20:29 WEST by Codex — auto-revisão

**Configuração GTM**
- [x] Mudança isolada no workspace `codex-2.11B.2-multitenant-preview` (`workspaceId=24`)
- [x] `quick_preview` compilou sem `compilerError`
- [x] Nenhuma versão foi publicada e nenhum deploy Cloud Run foi executado
- [x] Valores sensíveis não foram logados; validações registram apenas presença/hash curto quando necessário

**Arquitetura**
- [x] Tenant resolve por `Request Header` `Host`
- [x] Produto resolve por `Event Data` `produto`
- [x] GA4 Measurement ID, Meta CAPI token e Meta Pixel ID passam por lookup tables
- [x] A tag Meta CAPI foi unificada para evitar duplicidade por produto no preview

**Testes/validação**
- [x] Leitura Tag Manager API validada para account `6266094107`
- [x] Cloud Run confirmado em `us-central1` com serviços prod/preview
- [x] Domain mapping `sgtm.decolesuacarreiraesg.com.br` confirmado como Ready/CertificateProvisioned/DomainRoutable
- [x] `dig`, parse JSON do catálogo e `git diff --check` executados

**Resultado:** APROVADO

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-18 20:17 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa e próximo slice confirmado no `STATUS-2.11.md`.
- O que funcionou: escopo limitado a workspace/preview sGTM, sem publish produção e sem deploy.
- O que falhou: nada até agora.
- Próximo passo planejado: verificar acesso real ao Tag Manager API e exportar inventário do workspace antes de mutar.

### 2026-05-18 20:21 WEST by Codex

- O que foi tentado: leitura Tag Manager API com a service account local.
- O que funcionou: account `6266094107` lida com sucesso; container server-side identificado como `containers/241313282`, public ID `GTM-K6Q4H6BR`, com workspaces `23` Default e `17` preexistente.
- O que falhou: nada na leitura GTM.
- Próximo passo planejado: criar workspace isolado para a slice e inspecionar variáveis/tags/triggers antes da mutação.

### 2026-05-18 20:24 WEST by Codex

- O que foi tentado: criação do workspace GTM `codex-2.11B.2-multitenant-preview`.
- O que funcionou: workspace criado com `workspaceId=24` e descrição explícita "preview only; do not publish directly".
- O que falhou: nada.
- Próximo passo planejado: aplicar variáveis/lookup tables e atualizar tags em workspace 24.

### 2026-05-18 20:27 WEST by Codex

- O que foi tentado: refactor do workspace 24 via Tag Manager API.
- O que funcionou:
  - Criadas/atualizadas variáveis `RH - Host`, `ED - produto`, `ED - test_event_code`.
  - Criadas lookup tables `LT - Tenant ID by Host`, `LT - GA4 Measurement ID by Tenant`, `LT - Meta CAPI Token by Tenant`, `LT - Meta Pixel ID by Tenant/Product` e `LT - Meta Test Event Code by Tenant/Product`.
  - Tag `GA4` agora usa `{{LT - GA4 Measurement ID by Tenant}}`.
  - Tag Meta foi unificada como `Meta CAPI - Dynamic by Tenant/Product`, usando pixel/token/test code por lookup.
  - Tag/trigger Meta estáticos do pixel PlanoVoo foram removidos apenas no workspace preview.
  - `quick_preview` compilou sem `compilerError`.
- O que falhou: tentativa inicial de `quick_preview` só com escopo `tagmanager.edit.containers` retornou `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`; corrigido usando também `tagmanager.edit.containerversions` e `tagmanager.publish`.
- Próximo passo planejado: validar estado final por API e documentar.

### 2026-05-18 20:29 WEST by Codex

- O que foi tentado: validação pós-mutação e checagem de infra.
- O que funcionou:
  - Workspace 24 contém 8 variáveis, 2 tags (`GA4`, `Meta CAPI - Dynamic by Tenant/Product`) e 1 trigger (`All GA4 MP Events`).
  - `dig +short sgtm.decolesuacarreiraesg.com.br CNAME` retorna `ghs.googlehosted.com.`
  - Cloud Run API confirmou serviços `server-side-tagging` e `server-side-tagging-preview` em `us-central1`.
  - Cloud Run domain mapping `sgtm.decolesuacarreiraesg.com.br` aponta para `server-side-tagging` com Ready/CertificateProvisioned/DomainRoutable `True`.
  - `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"` ✅
- O que falhou: nada nas validações finais.
- Próximo passo planejado: commit do refactor externo documentado e fechamento de STATUS/master.

## Gotchas / lições aprendidas

- O container Web (`GTM-58CQ9K7X`) é diferente do container server-side (`GTM-K6Q4H6BR`); esta slice deve operar apenas no server-side.
- `gcloud` não está instalado localmente; validações GCP/GTM precisam usar API HTTP ou scripts Node com a service account.
- Já existia um workspace `codex-mp-routing-1777296276501` (`workspaceId=17`); ele foi deixado intocado.
- O Default Workspace não tinha variáveis e usava duas tags Meta CAPI estáticas por pixel, ambas com triggers `always`; a unificação dinâmica foi aplicada apenas no workspace 24.
- `quick_preview` não publica versão, mas exige escopo OAuth de containerversions/publish para compilar o preview pela API.

## Decisões tomadas (delta vs plano original)

- O workspace da slice é dedicado: `codex-2.11B.2-multitenant-preview` (`workspaceId=24`), sem reaproveitar o workspace 17 preexistente.
- A tabela `LT - Meta CAPI Token by Tenant` usa o token tenant-level originado de `META_SYSTEM_USER_ACCESS_TOKEN`/`META_CAPI_ACCESS_TOKEN_DECOLE`, alinhado ao catálogo v5. Os tokens antigos por produto permanecem apenas no workspace publicado até Fase 3.
- Os `test_event_code` atuais foram preservados em lookup por `tenant|produto` para reduzir drift no preview.
- Foram adicionadas linhas placeholder `superare-test` no preview para preparar a validação 2.11B.3; elas não foram publicadas em produção.
