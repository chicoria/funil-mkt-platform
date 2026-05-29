# Slice G1 — Governança reutilizável no `workspace-agent-guidelines`

> Satélite: engagement · Repo alvo: `workspace-agent-guidelines`
> Estimativa: 0,5 dia

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |
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

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
