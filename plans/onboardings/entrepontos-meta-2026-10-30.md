# Entrepontos — configuração Meta (2026-10-30)

## Autorização e objetivo

Decisão atual, explícita do utilizador: **usar a conta BRL existente, com
campanhas Entrepontos separadas**. Conta `act_604577275311600`, Elizete Fazza ESG,
BRL, America/Sao_Paulo, país de faturação BR. Preservar moeda, fuso, país,
pagamento, nome da conta, campanhas existentes e pixels DECOLE. Associar apenas
o Pixel Entrepontos já criado (`1709529480821304`). Sem lançamento de campanhas,
orçamento, pagamentos ou reativação das contas encerradas.

Atualização de 2026-11-02: Página Facebook Entrepontos `1501807893006756`
confirmada publicada e propriedade do Business; `agent-api` tem ADVERTISE e
MANAGE. Instagram Entrepontos ainda não aparece no Business nem ligado à Página.
O link `@entrepontos.betweenstitches` no site não comprova existência/controlo.

O plano inicial de conta nova BRL/Europe/Lisbon foi substituído; a execução
e os bloqueios anteriores ficam preservados no histórico abaixo.

## Fatia M1 — ativos Meta e acessos

Status: DONE (ativos, associação e atribuição ao system user confirmados por Slice Validator independente; envio CAPI fora do aceite M1).
Classificação: externo/sensível.

- Confirmar por GET os IDs da conta ativa e do Pixel Entrepontos, proprietário,
  moeda/fuso/país atuais e tarefas do token. Não criar recursos adicionais.
- Inventariar associações do Pixel e pixels da conta com paginação completa;
  erro de leitura não equivale a ausência. Se já associado, não repetir POST.
- Se ausente, `POST /1709529480821304/shared_accounts` com
  `account_id=604577275311600` e Business correto; confirmar por GET dos dois
  lados e preservar pixels existentes. Após timeout, reconciliar antes de retry.
- Reconsultar `assigned_users` do Pixel. Se `agent-api` continuar ausente,
  preservar o bloqueio #10 já observado; não repetir atribuição sem mudança
  de estado nem escalar permissões da app. O titular atribui pela interface.
- Usar o token de sistema existente como candidato CAPI; confirmar permissões
  no Pixel, sem afirmar envio validado apenas por GET.
- Guardar apenas IDs públicos e evidências sanitizadas neste documento.
  Valores de tokens permanecem exclusivamente na fonte local de credenciais.
  Respostas e erros devem passar por allowlist de campos e redação de secrets;
  não guardar respostas integrais, URLs com tokens nem comandos com credenciais.
- Instagram continua pendente de associação; Página criada em verificação de 02/11. Partilha
  ficam para M2, sem impedir a associação independente do Pixel já criado.

### Aceite e evidência

GET confirma conta existente com nome/BRL/São Paulo/Business previstos, Pixel com proprietário
correto, atribuição ao system user e associação à conta. Em caso de rejeição,
registar código/mensagem sanitizados e condição exata para desbloqueio, sem
marcar M1 DONE. Recursos criados parcialmente devem ser preservados e registados.
Não criar campanhas nem enviar eventos reais nesta fatia.

### Rollback e riscos

Alteração limitada à associação do Pixel Entrepontos à conta aprovada. Rollback:
remover apenas a associação criada nesta execução, se necessário, sem apagar
Pixel/conta nem tocar nos pixels DECOLE. Registar baseline e comparar depois.
Nenhuma campanha/gasto/evento. Se houver erro, reconciliar por GET e parar a
operação dependente. Não escalar permissões da app ou alterar propriedade.

### Catálogo e implantação

Esta fatia prepara ativos isolados, sem ativação runtime. Não adicionar ainda
configuração Meta ao catálogo nem publicar Workers/GTM: isso depende de validar
tracking/consentimento e definir o reporting por campanha da conta partilhada
entre DECOLE e Entrepontos, incluindo Mulheres e Kids. Nenhum total agregado
da conta pode ser atribuído integralmente a cada tenant/produto. Avaliar catálogo
novamente na fatia de integração.

## Próximas fatias, dependentes do inventário M1

- M2: Página/Instagram, pagamento pelo titular e acesso CAPI de teste.
- M3: revalidar HTTPS/sGTM e consentimento; configurar catálogo/secrets/GTM;
  testar conversões e deduplicação, com revisão independente antes de publicação.
- M4: métricas por campanha/tenant/produto, separando DECOLE e Entrepontos
  (Mulheres/Kids), sem duplicar ou misturar totais da conta.

## Ledger

Ledger de referência: [STATUS-ENTREPONTOS-META.md](../STATUS-ENTREPONTOS-META.md).

| Fatia | Critério de aceite | Evidência exigida | Status |
|---|---|---|---|
| M1 | Conta existente BRL/São Paulo preservada, Pixel, acesso e associação confirmados | GETs sanitizados + revisão independente | DONE |
| M2 | Identidades e pagamento prontos; CAPI de teste validado | IDs e teste controlado | NOT_STARTED |
| M3 | Tracking integrado e consentido sem regressões | versões live, smokes e eventos de teste | NOT_STARTED |
| M4 | Reporting separado por campanha/tenant/produto, incluindo DECOLE | testes e comparação com Insights | NOT_STARTED |

## Resultado atual — ativos e acessos M1 concluídos

- Conta escolhida: **`act_604577275311600`**, Elizete Fazza ESG.
- Configuração preservada: **BRL / America/Sao_Paulo / país BR**, estado ativo.
- Pixel Entrepontos: **`1709529480821304`**, associado à conta por API.
- `agent-api` e `Conversions API System User` atribuídos pelo titular ao Pixel;
  GET independente confirma ADVERTISE/UPLOAD/ANALYZE/EDIT para ambos.
  CAPI ainda não testado: permissões e associação não comprovam envio de eventos.
- Página Facebook Entrepontos `1501807893006756` publicada (GET 2026-11-02), com
  acesso `agent-api`; Instagram ainda não visível/ligado. Ver ressalva promote_pages abaixo.
- Não há nova campanha, orçamento, pagamento, publicação de tracking ou deploy.
- Catálogo permanece sem Meta Entrepontos até à integração de tracking e reporting
  por campanha que separe DECOLE/Entrepontos e Mulheres/Kids.

Evidência atual: [atribuição e GETs independentes](evidence/entrepontos-meta-access-2026-10-30.json),
complementada pela [associação à conta existente](evidence/entrepontos-meta-reuse-2026-10-30.json).

## Execução (append-only)

- Inventário anterior nesta conversa: Business `Elizete Fazza ESG`, app `DECOLE
  Agents API`, system user `agent-api`; token principal válido, com ads_read,
  ads_management e business_management. Conta acessível ativa em BRL/São Paulo;
  apenas Página/Instagram Elizete e pixels DECOLE/Plano de Voo visíveis.
- Worktree contém alterações anteriores; preservá-las. Plano novo é o único
  ficheiro introduzido nesta etapa. Nenhum valor de secret no repositório.

## Planning Review independente — 2026-10-30

Revisor: `meta_planning_review` (não implementador).
Resultado: APROVADO COM AJUSTES, incorporados acima antes de execução.

- MUST-FIX: nenhum pendente após incorporar inventário completo/ambíguo,
  reconciliação após timeout, confirmação de IDs e proteção dos outputs.
- SHOULD-FIX: ao abrir execução multifatia, manter o ledger em ficheiro
  `STATUS-*.md` conforme guideline; não afeta a autorização operacional M1.
- Riscos aceites: recursos Meta duráveis, criação de conta sujeita a limite e
  elegibilidade, combinação BRL/fuso Lisboa ainda por confirmar no POST/GET.
- Critérios: leituras antes/depois verificam proprietário, moeda, fuso, acessos
  e associação; erro não produz DONE. Atribuição no Pixel não comprova CAPI.
- Catálogo: adiar ativação runtime é adequado nesta fatia de recursos isolados.
- Escopo: sem campanhas, gastos, pagamento, eventos reais, publicação GTM/Workers
  ou alterações aos ativos DECOLE. Mutação de recursos independentes pode
  continuar se a criação da conta estiver bloqueada.
- Sem código de produto alterado nesta fatia; verificação por GETs e revisão
  de evidência é proporcional. Se surgir script reutilizável de produto,
  testes e Code Quality Review passam a ser necessários.

## Execução M1 — 2026-10-30

Evidência: [GETs/POSTs sanitizados](evidence/entrepontos-meta-2026-10-30.json).

1. Inventários completos de contas/pixels confirmaram ausência de Entrepontos.
   Business `577362448377604` e system user `122106250778782480` (`agent-api`)
   confirmados por GET antes de escrita. Business continua `not_verified`.
2. Fonte Meta de timezone consultada diretamente por HTTPS:
   `https://developers.facebook.com/docs/marketing-api/reference/ad-account/timezone-ids/`.
   Tabela confirma `TZ_EUROPE_LISBON = 110`.
3. `POST /577362448377604/adspixels`, nome `Entrepontos`, retornou ID
   **`1709529480821304`**. GET confirmou nome e proprietário correto.
4. `POST /1709529480821304/assigned_users` para `agent-api`, com tarefas
   ADVERTISE/UPLOAD/ANALYZE/EDIT, rejeitado: HTTP 400, código **10**, mensagem
   `Application does not have permission for this action`. GET posterior
   confirmou `assigned_users: []`. Não repetir com outro token nem escalar app.
5. `POST /577362448377604/adaccount` para `Entrepontos`, BRL, timezone 110,
   sem funding/payment, rejeitado: HTTP 400, código **3979**, subcódigo
   **2455008**, `Limite da conta de anúncios atingido`. Resposta Meta indica
   limite do Business e sugere aguardar elegibilidade ou verificar a empresa.
   Isso não garante que a verificação aumente imediatamente o limite.
6. GET posterior confirmou as mesmas três contas anteriores; nenhuma conta
   Entrepontos foi criada. Não houve retry de criação após a rejeição.
7. Utilizador informado e consultado sobre reutilizar a conta existente
   `act_604577275311600` (BRL/America/Sao_Paulo) ou manter a conta separada e
   resolver o limite. Decisão pendente; não associar automaticamente o Pixel
   à conta DECOLE. Links da Página/Instagram também solicitados e pendentes.

### Retoma concreta

- No Business Settings, em Fontes de dados → Datasets/Pixels → Entrepontos
  (`1709529480821304`), atribuir o system user `agent-api` às permissões de
  gestão/uso do Pixel; a localização exata do controlo pode variar na interface.
  Alternativamente, Utilizadores → Utilizadores do sistema → agent-api →
  Adicionar ativos → selecionar o dataset. Confirmar novamente por API depois.
- Escolher conta existente ou resolver limite de criação; reinventariar antes
  de qualquer nova tentativa e associar apenas a conta aprovada.
- Recolher Página/Instagram Entrepontos e concluir as partilhas pelo titular.
- Só então testar CAPI e executar as fatias de integração com revisão própria.

### Alterações e validação

- Alterados apenas este plano e a evidência sanitizada. Credenciais e catálogo
  não alterados: não há conta/acesso completos para ativar runtime Meta.
- Nenhum deploy, campanha, orçamento, cobrança ou evento enviado. Ativos DECOLE
  preservados. Pixel Entrepontos mantido para retoma, sem criar duplicado.
- Revisão independente de encerramento solicitada; M1 não cumpre aceite DONE.

## Code Quality operacional e Slice Validator — 2026-10-30

Revisor independente: `meta_planning_review`.
Code Quality operacional: APROVADO COM RESSALVAS.
Slice Validator: **BLOCKED**; não cumpre aceite para DONE.

- GETs independentes confirmaram Pixel `1709529480821304`, nome `Entrepontos`,
  proprietário `577362448377604`; inventário completo das contas permanece
  com os três IDs anteriores, sem conta Entrepontos.
- GET independente `assigned_users`, com parâmetro `business`, confirmou
  `data: []` e ausência de próxima página. Primeira leitura sem esse parâmetro
  devolveu #100 e foi corrigida; erro e sucesso constam na evidência.
- Bloqueios externos verificados documentalmente: POST atribuição recusado
  (#10), criação de conta recusada por limite (#3979/sub2455008). Não há
  evidência de associação Pixel–conta ou envio CAPI e não são apresentados
  como concluídos.
- Saída: titular atribui `agent-api` ao Pixel e GET confirma tarefas; resolve
  limite e cria conta BRL/Lisboa, ou aprova explicitamente plano revisto para
  conta existente. Só depois associar e verificar conta–Pixel. Não repetir
  criação de Pixel já existente.
- Instagram identificado no site local: `@entrepontos.betweenstitches`,
  referenciado em `/Users/chicoria/git/entrepontos/site/index.html`; isso não
  comprova propriedade/acesso no Business. Página Facebook ainda por identificar.
- MUST-FIX de implementação: nenhum identificado. Pendências funcionais
  acima impedem DONE. Nenhuma leitura de valores de credenciais em outputs;
  verificação estrutural da evidência não encontrou tokens, senhas ou chaves.
- Checks: JSON analisado; revisão do helper operacional temporário; GETs
  independentes sem mutações; `git diff --check` passou. Sem código de produto
  alterado, não são necessários testes unitários para esta fatia operacional.
- Catálogo permanece sem ativação Meta Entrepontos, apropriado ao estado parcial.
  Ledger `STATUS-ENTREPONTOS-META.md` criado, resolvendo o SHOULD-FIX de planeamento.

## Planning Review de retoma — conta existente — 2026-10-30

Revisor independente: `meta_planning_review`.
Resultado: **APROVADO COM AJUSTES**, incorporados nesta revisão.

- Decisão nova do utilizador: usar `act_604577275311600`, BRL/São Paulo,
  com campanhas Entrepontos separadas. Substitui o requisito de conta nova
  BRL/Lisboa e remove o limite de criação como dependência do plano atual.
- Preflight revisto em `/tmp/entrepontos-meta-audit/provision-evidence.jsonl`,
  passos `reuse_*`: conta ativa, moeda/fuso/país esperados, tarefas MANAGE e
  ADVERTISE; Pixel Entrepontos com proprietário correto; associação ausente
  e dois pixels DECOLE existentes. Incorporar esses registos à evidência
  durável sanitizada ao concluir a operação.
- Escrita aprovada apenas para `shared_accounts` do Pixel `1709529480821304`
  e conta `604577275311600`, Business `577362448377604`; verificar pelos dois
  lados e comparar os IDs dos pixels DECOLE antes/depois.
- Preservar nome, moeda, fuso, país, pagamento, campanhas e pixels existentes.
  Nenhuma criação de conta, campanha ou evento nesta retoma. Se a associação
  falhar, reconciliar e registar bloqueio sem usar endpoint alternativo que
  altere propriedade ou escale permissões.
- A atribuição `agent-api` continua pendente com #10 conhecido; autorização
  para tentar a associação independente não significa acesso CAPI resolvido.
  M1 só pode chegar a DONE com atribuição e associação confirmadas.
- Ajuste de M4: filtrar campanhas entre tenants DECOLE/Entrepontos e entre
  produtos Mulheres/Kids; não basta separar apenas produtos Entrepontos.
- MUST-FIX pendente: nenhum para esta escrita isolada. Retoma APROVADO_BUILD;
  novo Slice Validator deve atualizar o estado após GETs de resultado.

## Execução da decisão de reutilização — 2026-10-30

Após Planning Review revisto, `POST /1709529480821304/shared_accounts` com
`account_id=604577275311600` e `business=577362448377604` retornou `success: true`.
GET `shared_accounts` confirmou a conta escolhida; GET completo `adspixels` da
conta passou de dois para três pixels, com DECOLE ESG `1329973348435032` e
Plano de Voo `2220600768748665` preservados, e Entrepontos acrescentado.
GET da conta confirmou moeda/fuso/país/nome/estado inalterados. GET `assigned_users`
do Pixel permaneceu vazio. Não repetida a operação de atribuição recusada (#10).

Credenciais locais e catálogo não alterados nesta execução. Alterados apenas
plano/ledger e evidência sanitizada. Pendente validação independente da associação
e atualização do estado M1 sem declarar acesso CAPI concluído.

## Slice Validator da reutilização — 2026-10-30

Revisor independente: `meta_planning_review`.
Code Quality operacional da associação: **APROVADO**.
Associação Pixel–conta: **concluída e validada**. M1: **BLOCKED** por atribuição
do system user ainda pendente; CAPI não testado nesta fatia.

Evidência: [retoma e GETs independentes](evidence/entrepontos-meta-reuse-2026-10-30.json).

- GET independente do Pixel confirma ID/nome/proprietário previstos.
- GET completo dos pixels da conta confirma os dois DECOLE preservados e
  Entrepontos acrescentado. GET completo inverso `shared_accounts` confirma
  apenas a conta aprovada `act_604577275311600`.
- GET independente da conta confirma nome, BRL, America/Sao_Paulo, país BR,
  Business, estado ativo e tarefas inalterados em relação ao baseline.
- GET completo `assigned_users` continua vazio: associação ao ad account não
  equivale a atribuição ao `agent-api`. Condição de saída M1: titular atribuir
  o system user ao Pixel e GET confirmar as tarefas adequadas. Não repetir
  associação já concluída nem criar Pixel/conta adicionais.
- Nenhum MUST-FIX na operação realizada. Limite da criação de conta deixou
  de ser bloqueante para a decisão atual. Página/Instagram continuam por criar
  segundo o titular; M2–M4 permanecem pendentes, sem ativação runtime.
- Checks: comparação automática dos IDs e baseline; JSON válido; scan de
  padrões de secrets; `git diff --check` passou. Revisão executou só GETs.

## Atribuição pelo titular e encerramento M1 — 2026-10-30

O titular atribuiu manualmente acesso ao Pixel Entrepontos e apresentou captura
de ecrã com `agent-api`, `Conversions API System User` e o próprio titular.
A mudança foi confirmada por GETs do implementador e por novos GETs independentes
do Slice Validator `meta_planning_review`, sem mutações nesta revisão.

Resultado: Code Quality operacional **APROVADO**; Slice Validator **M1 DONE**.
Evidência: [atribuição e validação independente](evidence/entrepontos-meta-access-2026-10-30.json).

- Pixel `1709529480821304`, nome Entrepontos, proprietário Business
  `577362448377604` confirmados.
- `assigned_users` completo confirma `agent-api` (`122106250778782480`) e
  `Conversions API System User` (`122163609698712497`), ambos com ADVERTISE,
  UPLOAD, ANALYZE e EDIT. Bloqueio de atribuição M1 resolvido pelo titular.
- Associação nos dois sentidos com `act_604577275311600` confirmada; os dois
  pixels DECOLE permanecem presentes. Conta ativa, nome/BRL/São Paulo/país BR
  e Business preservados.
- Aceite M1 satisfeito: ativos, associação e acessos. Isso não comprova que os
  tokens CAPI locais tenham acesso ao novo Pixel, nem entrega/deduplicação de
  eventos; nenhum evento foi enviado nesta validação.
- M2, M3 e M4 continuam NOT_STARTED: Página/Instagram, CAPI de teste,
  integração GTM/Workers/consentimento e reporting por campanha mantêm
  critérios próprios. Onboarding Meta completo não foi declarado.
- JSON, invariantes de IDs/tarefas/baseline e scan de padrões de secrets
  passaram; `git diff --check` passou. Catálogo e credenciais não alterados.


## Reverificação read-only — 2026-11-02

Evidência: [GETs sanitizados](evidence/entrepontos-meta-recheck-2026-11-02.json).
Conta `act_604577275311600` continua ativa BRL/São Paulo/BR. Pixel Entrepontos
`1709529480821304` disponível, owner correto, associado à conta e com tarefas
ADVERTISE/UPLOAD/ANALYZE/EDIT para `agent-api` e Conversions API System User.

Página **Entrepontos `1501807893006756`** aparece em owned_pages; GET da Página
retorna `is_published=true`, link https://www.facebook.com/1501807893006756.
Assigned users inclui `agent-api` com ADVERTISE/CREATE_CONTENT/MANAGE, entre outras.
Nenhum instagram_business_account ou connected_instagram_account devolvido;
inventário Instagram do Business contém apenas `elizetefazza`. Isto não prova
que não exista um perfil Entrepontos fora dos ativos acessíveis.

Ressalva: `act_604577275311600/promote_pages` devolve apenas a Página Elizete;
a disponibilidade da nova Página para anúncios nesta conta ainda requer
validação. Não atribuir automaticamente a causa a permissões ou propagação.
Pixel `/stats?aggregation=event` devolve lista vazia e `last_fired_time` não foi
retornado. Sem evidência de eventos recebidos nesta consulta; sem teste CAPI.
Nenhuma mutação Meta, campanha, pagamento, secret, catálogo ou runtime alterado.
M1 permanece concluído; M2–M4 não foram fechados nesta reverificação.
