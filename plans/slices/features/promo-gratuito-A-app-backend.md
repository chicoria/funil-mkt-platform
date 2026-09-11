# Fatia A — Promo gratuito: backend do resgate (Plano de Voo)

> Feature: `decole-plano-de-voo-app` — schema + repository + service + route
> Estimativa: 4–6 horas
> Diagramas: `mkt-brain/knowledge-core/docs/promo-gratuito-{components,interactions}.puml`

## Status

| Campo | Valor |
|---|---|
| Estado | Em revisão final — código completo e verde, aguardando decisão do usuário sobre commit |
| Started | 2026-09-11 |
| Completed | — |
| Commit final | — (nenhum commit criado ainda; ver Execução) |

## Contexto

Campanhas promocionais (ex.: lote-piloto do grupo "Carreira em ESG", 207 membros)
precisam entregar o Plano de Voo gratuitamente, sem passar pelo checkout Hotmart.

Alternativas descartadas:
- **Cupom de 100% na Hotmart**: não confirmado se a plataforma permite preço final
  R$ 0; vendas até R$ 10 já caem na faixa de microtransação (20%); a taxa fixa por
  transação sobe para R$ 2,49 em 21/09/2026. Depender disso é risco desnecessário.
- **Reusar `POST /api/admin/tokens`**: é ferramenta interna e agora exige
  `admin_session` (corrigido no commit `b13512e`, que fechou uma rota aberta em
  produção). Não pode virar endpoint público de campanha.

Esta fatia entrega o núcleo: um código promocional com cota, validade e dedupe por
e-mail, que cria o token do Plano de Voo exatamente como uma compra criaria.

## Mudança

### 1. Migration — `db/` (seguir convenção do `db/init.sql`)

```sql
CREATE TABLE plano_voo_promo_codes (
  code         TEXT PRIMARY KEY,
  campanha     TEXT NOT NULL,
  max_usos     INT  NOT NULL,
  usos_atuais  INT  NOT NULL DEFAULT 0,
  expira_em    TIMESTAMPTZ,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plano_voo_tokens ADD COLUMN promo_code TEXT
  REFERENCES plano_voo_promo_codes(code);

-- dedupe: uma pessoa so resgata um mesmo codigo uma vez
CREATE UNIQUE INDEX plano_voo_tokens_email_promo_uniq
  ON plano_voo_tokens (email, promo_code)
  WHERE promo_code IS NOT NULL;
```

O índice parcial é o mesmo espírito da idempotência de `createTokenForPurchase()`
(UNIQUE parcial em `hotmart_transacao`) — a garantia mora no banco, não só no código.

### 2. `lib/promo/promo-repository.ts`

| Função | Responsabilidade |
|---|---|
| `getPromoCode(code)` | SELECT da linha do código |
| `findTokenByEmailAndCode(email, code)` | dedupe — devolve token existente ou null |
| `createTokenForPromo({code, email, nome})` | transação: valida cota com `SELECT ... FOR UPDATE`, upsert candidato, INSERT token, `usos_atuais += 1` |

Cota e incremento na **mesma transação** com lock de linha — sem isso, dois resgates
simultâneos no último slot estouram `max_usos`.

### 3. `lib/promo/promo-service.ts`

`PromoService.redeem(code, email, nome)` → discriminated union:

| Resultado | Quando |
|---|---|
| `{ kind: 'created', token, formUrl }` | caminho feliz |
| `{ kind: 'already_redeemed', token, formUrl }` | e-mail já resgatou este código |
| `{ kind: 'invalid' }` | código não existe ou `ativo = false` |
| `{ kind: 'expired' }` | passou de `expira_em` |
| `{ kind: 'exhausted' }` | `usos_atuais >= max_usos` |

E-mail transacional via `BrevoTransactionalEmailSender` (`packages/shared/transactional-email`),
com template ID do catálogo — **não** HTML inline como no `/api/admin/tokens` legado.
Reusar o template `purchaseLink` (id 12) ou criar um dedicado; decidir na execução.

### 4. `app/api/promo/[code]/route.ts`

`POST { email, nome }` → chama o service → mapeia o resultado para HTTP
(`200` created/already_redeemed, `404` invalid, `410` expired/exhausted).
Rota **pública de propósito** — o controle de abuso é cota + validade + dedupe,
não autenticação.

> A página `/promo/[code]` (UI, redirect pra LP quando falta e-mail, tela de
> "vagas esgotadas") entra na **Fatia D**, junto com a LP. Esta fatia é só backend.

## Testes (TDD Red primeiro)

`lib/promo/__tests__/promo-repository.test.ts`
- cota respeitada no limite (`usos_atuais = max_usos - 1` → cria; `= max_usos` → recusa)
- `usos_atuais` incrementado exatamente 1x por resgate
- índice único barra segundo INSERT com mesmo `(email, promo_code)`

`lib/promo/__tests__/promo-service.test.ts`
- cada um dos 5 `kind` do union
- `already_redeemed` devolve o token **existente**, não cria outro
- e-mail disparado só em `created` (não em `already_redeemed`)
- código com `expira_em` no passado → `expired` mesmo com cota sobrando

`app/api/promo/[code]/route.test.ts`
- mapeamento de cada `kind` para o status HTTP correto
- body sem `email` → 400
- JSON inválido → 400 (não 500) — mesma decisão M6 do Plano 1

## Revisão G.12

> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE.

Pontos de atenção para o revisor:
- A validação de cota está sob lock transacional? (race no último slot)
- Camadas respeitadas — route não fala com `pg`, service não monta SQL?
- E-mail via `BrevoTransactionalEmailSender`, não `fetch` inline?
- `tsc --noEmit` limpo, sem `any` não justificado
- TDD Red antes de Green comprovável no log de commits

## Execução (append-only)

**2026-09-11** — Implementação completa em `decole-plano-de-voo-app`, TDD Red→Green:

- Red: `lib/promo/__tests__/promo-repository.test.ts`, `lib/promo/__tests__/promo-service.test.ts`,
  `app/api/promo/[code]/route.test.ts` escritos primeiro, confirmados falhando (módulos inexistentes).
- Green: `db/init.sql` (tabela `plano_voo_promo_codes`, coluna `plano_voo_tokens.promo_code`,
  índice único `plano_voo_tokens_email_promo_uniq`), `PromoRepository`, `PromoService`,
  `app/api/promo/[code]/route.ts`. 86/86 testes do repo passando, `tsc --noEmit` limpo,
  `eslint` limpo.
- Revisão G.12 por agente separado (`ecc:code-reviewer`, sem contexto prévio da sessão):
  achou 2 MUST-FIX e 4 SHOULD-FIX/NICE-TO-HAVE. MUST-FIX e a maioria dos SHOULD-FIX corrigidos
  na sequência (TDD Red→Green de novo: 6 testes novos/alterados, todos verificados vermelhos
  antes do fix). Suite final: 91/91 verde, tsc e eslint limpos.
- **Pendente**: nenhum commit foi criado (a sessão não commita sem pedido explícito do usuário).
  Aplicação da migration em produção também pendente — `db/init.sql` só roda no primeiro init
  do container Postgres; produção já tem schema sincronizado manualmente (ver comentário no
  topo do arquivo), então este ALTER/CREATE precisa de um `psql` manual à parte, fora do escopo
  desta sessão.
- **Pendente de config (deploy)**: nova env var `BREVO_TEMPLATE_ID_PROMO` (id do template
  transacional na Brevo) precisa ser criada e configurada — não reusei o `purchaseLink` (id 12)
  hardcoded, decisão abaixo.

## Gotchas / lições aprendidas

- **`packages/shared/transactional-email` não é importável de `decole-plano-de-voo-app`**: é um
  repo git separado (remotes diferentes), sem `package.json`, sem tooling de workspace/monorepo
  entre os dois. A classe `BrevoTransactionalEmailSender` foi *copiada* (não linkada) para
  `lib/email/brevo-transactional-email-sender.ts`. Se isso incomodar no futuro, a correção real
  é dar `package.json` ao pacote compartilhado e resolvê-lo via npm/workspace — fora do escopo
  desta fatia.
- **A cópia local DIVERGE do original de propósito**: a pedido do usuário, além de
  `templateId`/`params` (modo do pacote original), a classe local também aceita
  `sender`/`subject`/`htmlContent` (HTML bruto). Isso permitiu consolidar o
  `/api/admin/tokens` legado (que mandava `fetch` inline pro Brevo com HTML hardcoded) para usar
  a mesma classe da Fatia A, em vez de duplicar lógica de request/timeout/erro. Não presumir
  paridade de contrato com `funil-mkt-platform/packages/shared/transactional-email` — está
  documentado no topo do arquivo local. Testado em
  `lib/email/__tests__/brevo-transactional-email-sender.test.ts` (5 casos, TDD Red→Green).
  Comportamento do `admin/tokens` preservado 1:1 (mesmo guard "sem `BREVO_API_KEY` → pula envio
  silenciosamente" que já existia — não foi endurecido, é escopo de outra decisão).
- **Ordem dos checks em `PromoService.redeem` importa**: o dedupe (`findTokenByEmailAndCode`)
  precisa vir *antes* dos checks de `invalid`/`expired`/`exhausted` — senão alguém que já
  resgatou perde acesso ao próprio token quando a campanha é desativada ou expira depois. Isso
  só apareceu na revisão G.12, não estava nos testes originais do plano.
- **E-mail é best-effort, não pode ser síncrono-obrigatório**: como o índice único bloqueia um
  segundo resgate do mesmo `(email, code)`, se o envio de e-mail falhasse *depois* do commit do
  token (Brevo fora do ar, `BREVO_API_KEY` ausente etc.) o usuário ficaria sem link e sem
  caminho de recuperação (a resposta `already_redeemed` não reenvia). Corrigido para capturar
  falha de envio, logar (`console.error`), e retornar `created` com `formUrl` mesmo assim —
  a resposta HTTP síncrona é o caminho garantido de entrega, o e-mail é redundância.

## Decisões tomadas (execução)

- **Template Brevo não hardcoded**: `CLAUDE.md` do workspace proíbe hardcodar template IDs.
  Em vez de reusar o `purchaseLink` (id 12) como o plano sugeria como opção, criei um template
  dedicado via nova env var `BREVO_TEMPLATE_ID_PROMO` — ainda não configurada em nenhum
  ambiente, precisa ser criada na Brevo e no `.env`/secrets de deploy antes de ir para produção.
- **Validação de formato de e-mail adicionada** (não estava no plano original): rota é pública
  por design (cota + validade + dedupe como única contenção), então uma checagem mínima de
  formato (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) evita queimar a cota da campanha piloto (207 pessoas)
  com strings arbitrárias. Achado da revisão G.12, não rate-limit (fora de escopo — depende de
  infra que não foi investigada).

## Decisões tomadas

- Dedupe é por `(email, promo_code)` — a mesma pessoa **pode** resgatar códigos de
  campanhas diferentes, mas nunca o mesmo código duas vezes
- Cota garantida por índice/lock no banco, não só por checagem em código
- Rota pública por design; contenção via cota + validade + dedupe
- Não reusar `/api/admin/tokens` (interno, autenticado, fora do padrão de camadas)
