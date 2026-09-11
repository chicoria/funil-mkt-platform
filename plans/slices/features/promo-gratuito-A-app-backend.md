# Fatia A — Promo gratuito: backend do resgate (Plano de Voo)

> Feature: `decole-plano-de-voo-app` — schema + repository + service + route
> Estimativa: 4–6 horas
> Diagramas: `mkt-brain/knowledge-core/docs/promo-gratuito-{components,interactions}.puml`

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |

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

(a preencher)

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- Dedupe é por `(email, promo_code)` — a mesma pessoa **pode** resgatar códigos de
  campanhas diferentes, mas nunca o mesmo código duas vezes
- Cota garantida por índice/lock no banco, não só por checagem em código
- Rota pública por design; contenção via cota + validade + dedupe
- Não reusar `/api/admin/tokens` (interno, autenticado, fora do padrão de camadas)
