# STATUS — Entrepontos Meta

Plano: [entrepontos-meta-2026-10-30.md](onboardings/entrepontos-meta-2026-10-30.md).
Evidência: [API sanitizada e validação independente](onboardings/evidence/entrepontos-meta-2026-10-30.json).
Retoma: [associação à conta existente e validação independente](onboardings/evidence/entrepontos-meta-reuse-2026-10-30.json).
Acessos: [atribuição pelo titular e validação independente](onboardings/evidence/entrepontos-meta-access-2026-10-30.json).

| Fatia | Critério de aceite objetivo | Evidência exigida | Status |
|---|---|---|---|
| M1 | Conta existente BRL/São Paulo preservada, Pixel, acesso e associação confirmados | GETs sanitizados e revisão independente | DONE |
| M2 | Identidades e pagamento prontos; CAPI de teste validado | IDs e teste controlado | NOT_STARTED |
| M3 | Tracking integrado e consentido sem regressões | versões live, smokes e eventos de teste | NOT_STARTED |
| M4 | Reporting separado por campanha/tenant/produto, incluindo DECOLE | testes e comparação com Insights | NOT_STARTED |

## Validação independente — 2026-10-30

Slice Validator `meta_planning_review`: M1 BLOCKED, entrega parcial preservada.
Pixel `1709529480821304` criado e proprietário confirmado por GET independente.
System user ainda sem atribuição no Pixel: GET devolve lista vazia; POST recusado
com #10. Conta Entrepontos não criada: limite de contas do Business, erro
#3979/sub2455008; inventário completo permanece inalterado. Nenhuma campanha,
associação à conta DECOLE, evento CAPI ou implantação runtime nesta fatia.

Condição de saída: atribuir `agent-api` ao Pixel pela interface com acesso do
titular e confirmar por GET; resolver limite para conta BRL/Lisboa, ou obter
decisão explícita de reutilizar a conta existente e rever plano/aceite; associar
Pixel à conta aprovada e confirmar. Reutilizar o Pixel já criado na retoma.

Instagram identificado no site: `@entrepontos.betweenstitches`; acesso no Business
e Página Facebook continuam pendentes. M2–M4 mantêm critérios próprios, sem
declaração de onboarding concluído.

## Retoma aprovada — 2026-10-30

Utilizador decidiu explicitamente usar a conta existente `act_604577275311600`
em BRL/America/Sao_Paulo, com campanhas Entrepontos separadas. Não criar nova
conta nem alterar moeda, fuso, nome, país, pagamento ou campanhas existentes.
Confirmou também que Página/Instagram Entrepontos ainda não existem; link no
site não comprova existência ou controlo.

Planning Review independente: APROVADO COM AJUSTES incorporados. M1 retoma
APROVADO_BUILD apenas para associação do Pixel `1709529480821304` à conta
aprovada, com GETs antes/depois e preservação dos pixels DECOLE. Preflight
confirma conta ativa e associação ausente. Atribuição do system user continua
pendente; o #10 não será repetido sem mudança de estado. Após a escrita,
Slice Validator atualiza estado — não há autorização para declarar DONE
enquanto acesso e associação não estiverem ambos confirmados.

O limite de criação permanece no histórico, mas deixou de bloquear o plano
atual. M4 exige isolamento das métricas DECOLE/Entrepontos e Mulheres/Kids.

## Validação da associação — 2026-10-30

Slice Validator `meta_planning_review`: associação concluída e APROVADA; M1
permanece **BLOCKED** apenas por atribuição do system user ao Pixel pendente.
GETs independentes confirmaram associação nos dois sentidos: Pixel Entrepontos
`1709529480821304` → conta `act_604577275311600`, e três pixels na conta com os
dois DECOLE preservados. Nome, BRL, America/Sao_Paulo, país BR, Business e estado
ativo mantidos. `assigned_users` continua vazio; sem teste CAPI ou runtime.

Saída M1: atribuir `agent-api` ao Pixel pela interface do titular e confirmar
por GET. Não repetir a associação já concluída. M2–M4 continuam pendentes,
incluindo criação de Página/Instagram e integração/reporting separado.

## Encerramento M1 — 2026-10-30

Slice Validator independente `meta_planning_review`: **M1 DONE**, após mudança
manual pelo titular e novos GETs read-only. Pixel `1709529480821304` mantém
proprietário correto e associação a `act_604577275311600`; dois pixels DECOLE
preservados. Conta ativa em BRL/America/Sao_Paulo, país BR, nome inalterado.
GET completo confirma `agent-api` e `Conversions API System User` com tarefas
ADVERTISE/UPLOAD/ANALYZE/EDIT. Bloqueio anterior de atribuição resolvido.

Aceite fechado apenas para ativos/associação/acessos. Nenhum envio de evento,
teste CAPI, implantação de tracking ou lançamento de anúncios nesta validação.
M2–M4 permanecem NOT_STARTED; catálogo e credenciais não alterados. JSON,
invariantes de baseline/permissões, scan de secrets e `git diff --check` passaram.


## Reverificação — 2026-11-02

GETs confirmam ativos/acessos M1 preservados. Página Entrepontos
`1501807893006756` agora publicada, owned pelo Business e com ADVERTISE/MANAGE
para `agent-api`. Instagram Entrepontos ainda não aparece ligado ou no inventário
do Business. `promote_pages` da conta devolve apenas Elizete: validar disponibilidade
da nova Página para anúncios antes de declarar identidades prontas. Pixel sem
eventos nas estatísticas consultadas. Nenhum teste CAPI, publicação ou mutação.
Evidência: [reverificação sanitizada](onboardings/evidence/entrepontos-meta-recheck-2026-11-02.json).
Estados das fatias não alterados; ver plano para detalhes e limites da consulta.

## M3 em preparação — 2026-11-02 (nada publicado)

Decisão do titular: reutilizar o Business `577362448377604` e seguir o modelo
DECOLE/PE: GA4 diferencia produtos pela variável `produto`; Meta usa **um pixel
por produto**.

- Conta efetiva: `act_2025745358091176` ("Entrepontos Conta Anuncio", BRL,
  pré-paga), associada aos dois pixels. A `act_604577275311600` do plano de
  30/10 deixa de ser a conta do Entrepontos.
- Pixels: Mulheres `1709529480821304` ("Entrepontos"); Kids `1102408865735469`
  (criado por API em 2026-11-02 com o token do `agent-api`; pessoas, `agent-api`
  e conta atribuídos pelo titular na interface). GET confirma `agent-api`
  com ADVERTISE/UPLOAD/ANALYZE/EDIT e a conta nos dois.
- GTM Web `GTM-NP5J47NR` (live v2): workspace `5` (`meta-pixels-por-produto-2026-11-02`),
  31 mudanças, 0 conflitos. Pixel_Setup/Pixel_Event/ParamBuilder por pixel,
  gated por `DL - produto`; `GA4_Event` único; Business_Events
  `^(generate_lead|cta_click)$`; `GA4 Event - All Custom Events` pausada.
  Workspace `4` é restolho não publicado (apagar na interface).
- sGTM `241313282` (live v27): workspace `35`, 0 conflitos. LT Pixel por
  `entrepontos|ENTREPONTOS_MULHERES|KIDS`, LT Token `entrepontos`, bloqueador
  `Meta Blocker — entrepontos fora da allowlist`
  (`^(gtm\.dom|generate_lead|sign_up|cta_click)$`). Sem linha em `LT - Meta Test
  Event Code` até haver os códigos.
- Catálogo: `metaPixel` por produto e `metaCapi.accessTokenEnv`
  (`META_SYSTEM_USER_ACCESS_TOKEN`); `updatedAt` 2026-11-02.
  `~/.env.local`: `META_PIXEL_ID_ENTREPONTOS_MULHERES|KIDS`.

Pendente: códigos de teste dos dois pixels (Events Manager) →
`META_TEST_EVENT_CODE_ENTREPONTOS_MULHERES|KIDS`; decisão de consentimento
(`ad_storage` hoje negado em `site/funnel.js`); `POST /{pixel}/events` de teste
(`events_received: 1`); smoke com deduplicação; contra-checagem independente;
autorização do titular para publicar os dois workspaces; export em
`trafego/gtm/`. Estados M2–M4 não alterados até lá.

### Códigos de teste e CAPI — 2026-11-02

Códigos fornecidos pelo titular (não secretos): Mulheres `TEST57663`, Kids
`TEST36097`; em `~/.env.local` (`META_TEST_EVENT_CODE_ENTREPONTOS_*`) e na
`LT - Meta Test Event Code by Tenant/Product` do workspace sGTM `35` (5 mudanças,
0 conflitos). `POST /{pixel}/events` de teste com o token do `agent-api`:
`events_received: 1` nos dois pixels (Kids sem avisos; Mulheres avisou que o
código não casava com uma sessão ativa de Eventos de teste, por isso o evento
foi recebido mas não aparece lá). Falta: consentimento, smoke no site com a
aba Eventos de teste aberta, contra-checagem e autorização para publicar.
