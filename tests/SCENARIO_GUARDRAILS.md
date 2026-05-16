# E2E Scenario Guard Rails

Este documento é obrigatório para implementar e revisar novos cenários em `tests/scenarios/`.

## Regras Para Implementação

1. **Classifique o cenário**
   - Cenários que chamam serviços externos, enviam email, disparam API de produto, alteram CRM, criam token ou mudam estado fora de D1/KV devem ter tag `"external"`.
   - Cenários `external` devem exigir `--include-external` via `tests/run-scenarios.sh`.

2. **Nunca use produção por default em cenário externo**
   - Não faça fallback silencioso para `https://api.decolesuacarreiraesg.com.br` em cenários `external`.
   - Exija `HOTMART_INGRESS_URL`, `PLANOVOO_API_BASE_URL` ou a URL staging equivalente.
   - Documente no README que o cenário requer ambiente isolado.

3. **Use identificadores descartáveis e únicos**
   - `event_id` deve começar com `e2e-`.
   - Transações Hotmart fake devem começar com `HP-E2E-`.
   - `anonymous_id` deve ser único e derivado do `event_id`.
   - Emails devem ser descartáveis: `e2e.*@...` ou `qa+e2e...@...`, salvo override explícito.

4. **Cleanup deve ser seguro por construção**
   - Cleanup destrutivo só pode apagar por identificadores E2E únicos (`event_id`, `anonymous_id`, `HP-E2E-*`).
   - Não apagar D1 por email genérico.
   - Não apagar contato Brevo por default se o email não for descartável.
   - Se houver side effect em produto externo, o cenário deve usar base/banco de staging ou implementar cleanup específico.
   - Deve existir forma de desativar cleanup para debug, como `E2E_CLEANUP=false` ou `--no-cleanup`.

5. **Evite falso positivo**
   - Polling em Brevo ou serviços externos deve filtrar por `date >= início do cenário`, quando disponível.
   - O conteúdo renderizado deve conter um identificador único do cenário, como transação `HP-E2E-*`.
   - Para links reescritos por provedores, resolva redirects antes de validar destino final.
   - Validar só “email/template existe” não é suficiente.

6. **Runner deve permanecer seguro**
   - `--all` deve continuar rodando apenas cenários seguros por default.
   - Cenários `external` não podem ser incluídos por acidente por tag ou por `--all`.
   - Se todos os cenários selecionados forem excluídos por safety gate, o runner deve falhar de forma clara.

7. **Preferir helpers compartilhados**
   - Reutilize `tests/lib/*` para HTTP, D1, Brevo, polling e assertions.
   - Se o cenário tem fluxo repetido, crie helper pequeno e testável em `tests/lib`.
   - Não duplique tokens, nomes de DB, endpoints ou padrões de cleanup.

## Checklist Para Revisão

- [ ] O cenário novo está listado em `tests/README.md`.
- [ ] Tags refletem os side effects reais (`external`, `brevo`, `tracking`, `recovery`, etc.).
- [ ] Cenários `external` exigem `--include-external`.
- [ ] Não há fallback silencioso para produção em cenário `external`.
- [ ] IDs e transações são únicos e têm prefixo E2E.
- [ ] Cleanup não apaga dados reais por email, domínio ou filtro amplo.
- [ ] Cleanup cobre D1/KV relevantes ou documenta resíduos externos inevitáveis.
- [ ] Brevo/CRM/API externa não são limpos sem allowlist/override explícito.
- [ ] Assertions provam o efeito principal do cenário, não apenas que um request retornou 202.
- [ ] Polling não aceita resultado stale de execução anterior.
- [ ] `node --check` passa para arquivos novos.
- [ ] `bash -n tests/run-scenarios.sh` passa se o runner foi alterado.
- [ ] `git diff --check` passa.

## Comandos Mínimos

```bash
node --check tests/scenarios/<novo-cenario>.mjs
bash -n tests/run-scenarios.sh
git diff --check
```

Para cenário externo:

```bash
tests/run-scenarios.sh --scenario <n> --include-external --env-file .env.staging
```

Para confirmar que o safety gate funciona:

```bash
tests/run-scenarios.sh --scenario <n> --env-file .env.staging
```

Esse último comando deve excluir o cenário externo e falhar de forma clara se nenhum cenário seguro restar.
