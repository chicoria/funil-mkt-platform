# SLICE-TEMPLATE.md

> Template canônico para slice files em `plans/slices/{satélite}/{N}-{título}.md`.
> Estrutura obrigatória — agente novo deve poder retomar trabalho lendo só este arquivo.

---

# Slice <ID> — <título curto (≤ 60 chars)>

> Satélite: <2.11A | 2.11B | 2.11C | 2.11D | 2.11T | 2.11Z>
> Estimativa: <X horas | 1 dia> (cada slice DEVE caber em ≤ 1 dia; se exceder, dividir)

## Status

| Campo | Valor |
|---|---|
| Estado | TODO \| IN_PROGRESS \| DONE \| BLOCKED \| ROLLED_BACK |
| Started | YYYY-MM-DD HH:MM por <agent ID / human> |
| Completed | YYYY-MM-DD HH:MM por <agent ID / human> |
| Commit final | `<hash>` (e tag se aplicável) |
| PR | <link GitHub> |
| Janela de smoke | YYYY-MM-DD → YYYY-MM-DD (se aplicável) |

## Contexto

Por que este slice existe. Qual problema resolve. Link para satélite que origina.
Manter sucinto (≤ 5 linhas) — detalhes vivem no satélite.

## Pré-requisitos

- [ ] Slice <X> DONE
- [ ] <recurso/acesso necessário (ex: CF_API_TOKEN com scope X)>
- [ ] <estado esperado (ex: catálogo v5 deployado)>

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `path/to/file.ts` | CREATE \| EDIT \| DELETE | O que muda |

### Diff conceitual

```typescript
// Antes
[código atual]

// Depois
[código novo]
```

### Mudanças no catálogo (se aplicável)

```jsonc
{
  // Campos adicionados/modificados em products.catalog.json
}
```

## Testes

### Unit

- [ ] `path/to/test.test.ts`: <descrição>
- [ ] <outros>

### E2E (se aplicável)

- [ ] `path/to/e2e.test.ts`: <descrição>

### Mocks/fixtures necessários

- `test/fixtures/<arquivo>.json`: <conteúdo>

## Validação executável

Comandos exatos com output esperado. Agente roda e captura.

```bash
# 1. Testes verdes
cd workers/<worker> && npx vitest run
# Esperado: N passed, 0 failed

# 2. Critério de aceite específico
<comando>
# Esperado: <output>

# 3. Audit (se aplicável)
bash scripts/audit-workers-agnostic.sh
# Esperado: 0 matches
```

## Smoke checklist (se aplicável)

- [ ] <ação manual ou semi-automática>: resultado esperado
- [ ] Logs Cloudflare: ausência de `handler_warn` por N horas
- [ ] D1 query: <SELECT que valida estado>

## Rollback

Passos exatos para reverter em <5min:

```bash
# 1. <comando>
# 2. <comando>
git revert <commit_hash>
wrangler deploy
```

Validação pós-rollback: <como saber que voltou ao estado anterior>.

## Execução (append-only — preenchido AO LONGO da execução)

### YYYY-MM-DD HH:MM by <agent ID>

- O que foi tentado: ...
- O que funcionou: commits `abc123`, deploy OK
- O que falhou: ... (e por quê)
- Próximo passo planejado: ...

### YYYY-MM-DD HH:MM by <agent ID>

- ...

## Gotchas / lições aprendidas

- Notas que ajudam o próximo agente que executar este ou slice similar
- Edge cases descobertos
- Diferenças entre o planejado e o real

## Decisões tomadas (delta vs plano original)

Se houver desvio do plano original, documentar aqui + atualizar PLANO-MASTER/satélite:
- Decisão: ...
- Motivo: ...
- Plano/satélite atualizado: ...

---

## Convenções de nomeação dos slice files

- `plans/slices/{satélite}/{N}-{kebab-case-título}.md`
- Exemplos:
  - `plans/slices/2.11A/0-secrets-store-setup.md`
  - `plans/slices/2.11A/3-refactor-resolve-tracking-tenant.md`
  - `plans/slices/2.11T/3-cross-tenant-isolation-test.md`
  - `plans/slices/2.11C/2-deploy-links-redirect.md`
- N começa em 0 (preparação) e segue ordem de execução do satélite
- Título: imperativo curto, kebab-case, ≤ 50 chars

## Política de criação de slice files (just-in-time)

**Não criar todos os ~30 slices upfront.** Criar apenas antes de iniciar a fase correspondente:

1. **Antes de iniciar Fase 0:** criar slices 2.11A.0, 2.11A.1, 2.11B.1, 2.11D.1
2. **Antes de iniciar Fase 0.5:** criar slices 2.11T.1-6 + 2.11D.0
3. **Antes de iniciar Fase 1:** criar slice 2.11A.2
4. **E assim por diante**

Slice file só vira IN_PROGRESS quando agente o pega para executar. Slices futuros podem ser planejados com menos detalhe e refinados quando a vez chegar.

**Exceção:** se um slice DONE revelar que próximo slice precisa ser dividido (descoberta), atualizar `STATUS-2.11.md` + criar slices novos antes de continuar.
