# Plans — funil-mkt-platform

Diretório centraliza todos os planos de design, governance e execução do `funil-mkt-platform`.

## Estrutura

```
plans/
├── README.md                        ← este arquivo
├── PLANO-MASTER-MULTI-TENANT.md     ← ponto de entrada autoritativo
├── STATUS-{plano}.md                ← source of truth de progresso de cada plano
├── SLICE-TEMPLATE.md                ← template canônico de slice
├── PLANO-{nome}.md                  ← planos ativos (em execução ou pré-execução)
├── RUNBOOK-{nome}.md                ← runbooks operacionais
├── slices/{satélite}/{N}-{título}.md ← slice files individuais
├── onboardings/{tenant}-{date}.md   ← registro de tenant onboardado
└── completed/                       ← planos 100% implementados (arquivados)
    └── PLANO-{nome}.md
```

## Convenções de nomeação

- `PLANO-*.md`: documentos de design (definem o quê e por quê)
- `STATUS-*.md`: source of truth de progresso de cada plano (atualizado a cada slice)
- `RUNBOOK-*.md`: passo-a-passo operacional (ex: onboarding tenant)
- `SLICE-TEMPLATE.md`: template canônico de slice (estrutura obrigatória)
- `slices/{satélite}/{N}-{kebab-case-título}.md`: slices individuais (N começa em 0)
- `onboardings/{tenant_id}-{YYYY-MM-DD}.md`: registro de tenant onboardado
- `completed/{PLANO-*}.md`: planos arquivados (100% concluídos)

## Ponto de entrada

Comece sempre por `PLANO-MASTER-MULTI-TENANT.md` (overview + governance + guard rails).
Para retomar trabalho em progresso: leia o `STATUS-{plano}.md` correspondente — **sempre**.

## Política de planos ativos vs `completed/`

- **Ativo** (em `plans/` raiz): plano com slices pendentes ou em execução
- **Completed** (em `plans/completed/`): plano 100% implementado, slices DONE, smoke verde por ≥7 dias
- **Critério de movimentação:** humano confirma + STATUS correspondente é arquivado junto
- **Commit message de arquivamento:** `chore(plans): archive PLANO-X — concluded YYYY-MM-DD`
- **Histórico:** `git log --follow plans/completed/PLANO-X.md` rastreia desde origem

## Política de atualização

- Toda PR que muda código/config alinhado a um plano **deve atualizar plano + STATUS correspondente**
- Plano master governa todas as mudanças que envolvem multi-tenancy
- Drift entre código e plano = bug em pipeline (ver G.6 / G.11 do plano master)
- CI roda `scripts/check-master-coherence.sh` e `scripts/check-status-coherence.sh` para detectar drift

## Continuidade entre agentes

Todos os planos seguem **agent-resumable workflow** (G.11 do master):
- Qualquer agente (Claude Code, ChatGPT, outro Claude, humano) retoma trabalho **sem contexto prévio**
- Slice files têm seção `Execução` append-only com timestamp + agent ID
- STATUS files têm seção `Recovery point` com ordem de leitura obrigatória
- Decisões tomadas durante execução são documentadas (delta vs plano original)

## Histórico

- **2026-05-18:** Criação inicial do diretório `plans/` consolidando todos os planos do repo
- **2026-05-18:** PLANO-STAGING-FUNIL-LANDING-PLANOVOO movido de `config/` para cá
- **2026-05-18:** PLANO-1-SEPARACAO-RESPONSABILIDADES movido de `decole-plano-de-voo-app/docs/` para `completed/` (concluído em 2026-05-14)
- **2026-05-18:** PLANO-2-DISPATCHER-GENERICO movido de `decole-plano-de-voo-app/docs/` (cross-repo) — Slices 2.0-2.10 concluídos; 2.11+ pendentes (split em satélites)
