# Slice 1 — Schema do catalog (comment automation)

Status: DONE

## Objetivo e problema

O motor de comentário-automação (Instagram/Facebook → auto-reply) precisa
de config no catalog antes de qualquer código: credenciais Meta, mapa
page/ig-id → produto, e regras de palavra-chave por produto. Sem isso,
nenhum slice seguinte (2-6) tem onde ler config.

## Escopo dentro

- `config/products.catalog.json`:
  - `tenants.decole.credentials`: adicionar `meta_access_token_env`
    (`META_SYSTEM_USER_ACCESS_TOKEN_DECOLE`), `meta_app_secret_env`
    (`META_APP_SECRET_DECOLE`), `meta_webhook_verify_token_env`
    (`META_WEBHOOK_VERIFY_TOKEN_DECOLE`).
  - `tenants.decole.metaApp`: novo bloco plano (não-secret) com `appId`
    (`1561616212633179`), `businessId` (`577362448377604`). **Nome
    `metaApp` (não `meta`)** — o catálogo já usa `meta` em
    `tenants.decole.products.{CODE}.meta.pixelIdEnvVar` com shape
    incompatível; usar o mesmo nome em outro nível da árvore criaria
    ambiguidade para humanos/agentes (achado do Planning Review).
  - `tenants.decole.socialAccounts`: `facebookPages["483391978198375"]`
    e `instagramBusinessAccounts["17841401638634396"]`, ambos
    `{ productCode: "DECOLE_PLANOVOO" }`.
  - `tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.rules[]`:
    1 regra (`id: planovoo_traducao_esg`, `keyword: "tradução"`,
    `matchType: "contains"`, `caseSensitive: false`,
    `platforms: ["facebook","instagram"]`, `publicReply`/`privateReply`
    com texto a definir com o usuário antes de fechar).
  - Atualizar `updatedAt` do catalog pra hoje.

**Limitação conhecida (autocontida neste slice, não só no plano mestre):**
resolver produto só por page/ig id em `socialAccounts` assume 1 Página = 1
produto. Se isso deixar de ser verdade, `match_comment_rule` (Slice 2) deve
aceitar lista de produtos candidatos do tenant em vez de falhar — não é um
problema deste slice, mas o slice não deve ocultar essa premissa.

## Escopo fora

- Nenhum código (`packages/`, `workers/`) — só JSON.
- Não promover secrets pro Secrets Store ainda (Slice 6).
- Não inscrever webhook no Meta ainda (Slice 6).

## Arquivos/módulos prováveis

- `config/products.catalog.json` (único arquivo modificado).

## Riscos e dependências

- Risco baixo: é só config aditiva, sem consumidor ainda lendo esses
  campos (Slices 2+ vão depender deste schema existir).
- Dependência: nenhuma (primeiro slice).
- Risco de schema: se `config/README.md` documenta um schema formal
  (JSON Schema/validador), confirmar que os campos novos não violam.

## Testes e validação executável

- `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"`
  (comando documentado em `config/README.md`) — JSON válido, sem erro de
  sintaxe.
- Revisão manual do diff: nenhum campo secreto com valor real (só nomes
  de env var); nenhum hardcode fora do padrão `credentials.*_env`.

## Critério de aceite

JSON válido (comando acima) + `updatedAt` atualizado + estes 6 JSON
pointers presentes com os valores especificados em "Escopo dentro":
- `.tenants.decole.credentials.meta_access_token_env`
- `.tenants.decole.credentials.meta_app_secret_env`
- `.tenants.decole.credentials.meta_webhook_verify_token_env`
- `.tenants.decole.metaApp.appId` / `.tenants.decole.metaApp.businessId`
- `.tenants.decole.socialAccounts.facebookPages."483391978198375"`
- `.tenants.decole.socialAccounts.instagramBusinessAccounts."17841401638634396"`
- `.tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.rules[0]`

## Rollback

`git checkout -- config/products.catalog.json` (sem dependentes ainda).

## Execução (append-only)

- **2026-06-21:** Planning Review (agente separado) → APROVADO COM AJUSTES.
  Ajustes incorporados no slice file: bloco `meta` renomeado para
  `metaApp` (evitar colisão com `products.{CODE}.meta`); critério de
  aceite passou a listar os 7 JSON pointers exatos; comando de validação
  alinhado com `config/README.md`; limitação "1 Página = 1 produto"
  replicada neste arquivo.
- **2026-06-21:** texto de `publicReply`/`privateReply` da regra
  `planovoo_traducao_esg` apresentado ao usuário em conversa e confirmado
  explicitamente ("pode confirmar e gravar") antes de gravar no catalog —
  publicReply: "Oi! Te mandei uma mensagem no privado 💬"; privateReply:
  "Oi! Vi seu comentário sobre 'tradução' 🙌 O Plano de Voo traduz sua
  experiência pra linguagem ESG em até 5 minutos — você confere aqui:
  https://decolesuacarreiraesg.com.br/planodevoo (garantia de 7 dias, sem
  risco)".
- **2026-06-21:** implementado em `config/products.catalog.json`:
  `credentials.meta_access_token_env/meta_app_secret_env/meta_webhook_verify_token_env`,
  bloco `metaApp` (appId/businessId), bloco `socialAccounts`
  (facebookPages/instagramBusinessAccounts), `products.DECOLE_PLANOVOO.commentAutomation.rules[0]`,
  `updatedAt` → `2026-06-21`.
- **2026-06-21:** validação `node -e "JSON.parse(...)"` → `JSON valido`.

## Revisão (Planning Review / Code Quality Review / Slice Validator)

**Planning Review: APROVADO COM AJUSTES** (ver Execução acima — todos os
MUST-FIX/SHOULD-FIX incorporados antes de implementar).

**Code Quality Review: APROVADO COM RESSALVAS**
- MUST-FIX: nenhum.
- SHOULD-FIX (resolvido nesta atualização): slice file não tinha Status/Execução/Revisão
  preenchidos no momento da review; texto de publicReply/privateReply não
  tinha evidência registrada de confirmação do usuário dentro do artefato
  (apesar de já confirmado em conversa) — ambos resolvidos acima.
- Checks revisados: JSON válido; 7 pointers presentes com shape correto;
  nenhum valor real de secret no diff (só nomes de env var); `metaApp` não
  colide com `products.{CODE}.meta` (paths e shapes diferentes,
  confirmado); `updatedAt` atualizado; diff não toca nada fora do escopo
  declarado; workers existentes (`api-hotmart-ingress`, `api-funnel-ingress`,
  `funnel-dispatcher`, `dashboard-sync`, `links-redirect`) acessam o
  catalog via optional chaining sem validador de schema estrito — mudança
  aditiva não quebra nenhum consumidor atual.

**Slice Validator: DONE** — critério de aceite (7 JSON pointers + JSON
válido + `updatedAt`) verificado objetivamente por agente independente do
implementador; lacuna de processo (Status/Execução/Revisão vazios) e gap
de confirmação de copy resolvidos nesta atualização. Sem MUST-FIX aberto.
