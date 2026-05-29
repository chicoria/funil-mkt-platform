# Slice G1 — Governança reutilizável no `workspace-agent-guidelines`

> Satélite: engagement · Repo alvo: `workspace-agent-guidelines`
> Estimativa: 0,5 dia

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-29 por Claude Sonnet 4.6 |
| Completed | 2026-05-29 por Adilson Chicoria (Slice Validator) |
| Commit final | `80e429e` (workspace-agent-guidelines) + `4ebf852` (funil-mkt-platform) + `73f39cd` (mkt-dashboard) + `fef0c1d` (decolesuacarreiraesg) |
| PR | — |

## Contexto

A camada de governança (Slice Validator + status estrito) não deve viver só neste plano: vira guideline reutilizável por todos os repos do workspace (que já apontam para `change-workflow.md`/`review-agents.md`). Mudança aditiva, feita sob o próprio fluxo do repo (`AGENTS.md`: problema → mudança pequena → revisar clareza/conflitos → tradeoff; PT operacional; sem secrets; `git diff --check`; atualizar `README.md`).

## Pré-requisitos

- [ ] Nenhum (independente dos demais slices)

## Mudança

### Arquivos a criar/modificar (repo workspace-agent-guidelines)

| Arquivo | Ação | Descrição |
|---|---|---|
| `guidelines/slice-validation.md` | CREATE | papel Slice Validator (estende `review-agents.md`), máquina de estados estrita, regra de bloqueio, "implementador não autoaprova", "transição só com evidência". Genérico. |
| `templates/slice-status-ledger.md` | CREATE | template do ledger (Slice · Critério de aceite · Evidência · Status) + legenda dos estados |
| `templates/slice-review-block.md` | EDIT | campos `Status:` (estado estrito) e `Evidência:` nos dois blocos |
| `README.md` | EDIT | listar os 2 novos documentos na seção *Documentos* |
| `templates/repo-AGENTS.stub.md` | EDIT (opcional) | referência curta ao validador |

## Testes

N/A (docs). Critério = clareza, ausência de conflito com guidelines existentes, `README` atualizado.

## Validação executável

```bash
cd workspace-agent-guidelines && git diff --check
# revisão de clareza/conflito conforme AGENTS.md do repo
```

## Rollback

```bash
git revert <hash>
```

Aditivo: repos que só usam `change-workflow.md`/`review-agents.md` seguem válidos.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- `slice-validation.md` estende (não duplica) `review-agents.md`?
- genérico (sem DECOLE/engajamento)? `README` atualizado? sem conflito?

## Revisão G.12 — preenchida pelo Slice Validator

### 2026-05-29 por Adilson Chicoria

**Resultado:** APROVADO

Evidência:
- `guidelines/slice-validation.md` criado: papel Slice Validator, máquina de estados estrita, regras de bloqueio — genérico, sem DECOLE/engajamento, estende `review-agents.md` sem duplicar.
- `templates/slice-status-ledger.md` criado: template do ledger com tabela e legenda de estados.
- `templates/slice-review-block.md` editado: campos `Status:` e `Evidência:` nos dois blocos.
- `README.md` e `repo-AGENTS.stub.md` atualizados.
- AGENTS.md atualizado nos 4 repos com referência ao `slice-validation.md`.
- `git diff --check` limpo. Commits commitados e confirmados.

MUST-FIX: nenhum.

## Execução (append-only)

### 2026-05-29 por Claude Sonnet 4.6

- Criados 6 arquivos em `workspace-agent-guidelines` (commits `80e429e`).
- AGENTS.md atualizado em funil-mkt-platform (`4ebf852`), mkt-dashboard (`73f39cd`), decolesuacarreiraesg (`fef0c1d`).
- Slice Validator (usuário) aprovou: sem MUST-FIX.

## Gotchas / lições aprendidas

- O arquivo `AGENTS.MD` em decolesuacarreiraesg usa M maiúsculo (case-sensitivity macOS vs git) — ao editar nesse repo usar `AGENTS.MD` no git add.
