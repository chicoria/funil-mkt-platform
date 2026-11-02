# Onboarding — Entrepontos (entrepontos.club)

Data: 2026-10-16. Tenant proposto: `entrepontos`.
Estado: captura/DOI e dashboard em produção; tracking em validação de HTTPS.
Onboarding completo autorizado pelo utilizador.

## Objetivo e âmbito

Integrar o domínio na plataforma partilhada: catálogo, funis, Brevo, GTM Web,
GA4, sGTM, Workers e dashboard. Seguir RUNBOOK-ONBOARDING-TENANT.md v2.
Não considerar uma frente concluída sem validação observada.

## Descoberta confirmada (leitura de APIs e repositórios)

- Zona Cloudflare ativa: entrepontos.club; site em entrepontos.pages.dev.
- Apex e www já configurados; não substituir os registos existentes.
- MX Cloudflare Email Routing e DKIM Brevo (brevo1/brevo2) já existem.
  Existência de DNS não comprova autenticação Brevo nem entrega de email.
- Brevo dedicada: credenciais ENTREPONTOS disponíveis em ~/.env.local.
  Nunca copiar valores para este documento, catálogo ou logs.
- Listas existentes: entrepontos-mulheres (2), entrepontos-kids (4).
  Não recriar nem migrar contactos existentes.
- GET /account e GET /contacts/lists respondem; GET /senders e domínio
  devolveram HTTP 403. A origem do 403 ainda não está identificada.
- Não existem variáveis GA4/GTM específicas da Entrepontos na fonte local.
  Aguarda confirmação de recursos existentes ou autorização para os criar.
- Catálogo tem decole e product-engineer; entrepontos ainda ausente.
- Site atual tem páginas /, /kids/ e /bio/; contacto via Instagram/copiar
  mensagem. Não existe formulário de captura nem snippet GTM no HTML inspecionado.
- Há alterações pré-existentes nos dois repositórios: preservar integralmente.

## Fatias propostas e critérios de aceite

1. Recursos Google e email: identificar/criar GTM Web e GA4, verificar sender
   hello@entrepontos.club, autenticação do domínio e encaminhamento existente.
   Aceite: IDs reais, versão live inventariada, sender ativo e estado DNS validado.
2. Funis e catálogo: dois produtos ligados às listas existentes, atributos Brevo,
   templates DOI e confirmação. Definir experiência de captura e consentimento
   antes de alterar o site; recolher apenas dados do adulto responsável em kids.
   Aceite: catálogo válido, referências reais e testes dos resolvedores.
3. Infraestrutura: Secrets Store, bindings, rotas api/links, sGTM e domain mapping;
   dashboard com isolamento de tenant. Aceite: dry-run e smokes positivos/negativos,
   versão live sGTM confirmada e tenants existentes sem regressão.
4. Site: captura por público, confirmação, consentimento e eventos GTM.
   Aceite: build/verificação do site, testes de interação e captura/DOI observados.
5. Validação independente: testes relevantes, GA4 Realtime, entrega de email e
   isolamento entre tenants; só o Slice Validator fecha as fatias.

## Dependências e revisão

Planning Review obrigatório antes da implementação não trivial. IDs Google e
acesso às APIs Brevo de remetentes são dependências ainda abertas. Checkout,
Hotmart e Meta só entram quando houver recursos e necessidade confirmados;
não inventar IDs nem copiar credenciais de outro tenant.

## Rollback

Registar IDs e versões anteriores antes de cada mutação. Reverter apenas entradas
Entrepontos no catálogo/bindings, restaurar versões dos Workers/GTM e retirar
apenas DNS criado nesta execução. Preservar MX, DKIM, listas e contactos existentes.
Revogar apenas secrets criados para este onboarding, após retirar os bindings.

## Execução (append-only)

- 2026-10-16: lido chat de referência e instruções locais/globais; escopo completo
  confirmado pelo utilizador; realizadas consultas de leitura descritas acima.
  Nenhuma mudança de produção efetuada. Catálogo ainda sem alterações enquanto
  dependências e recursos reais estão por confirmar.

## Revisão e ajuste — primeira fatia Google

Planning Reviewer independente: APROVADO COM AJUSTES em 2026-10-16.
As restantes frentes permanecem em descoberta; não fazer deploy nem alterar o site.

Utilizador confirmou que GA4/GTM ainda não existem e autorizou criar via API.
Inventário realizado com a service account configurada: GTM conta 6266094107
(Elizete Fazza), GA4 conta 346689750 (Elizete Fazza ESG), além das contas
separadas do Product Engineer. Usar as contas de Elizete para Entrepontos.

Primeira fatia executável (recursos isolados, sem deploy):
- GET containers da conta GTM e accountSummaries GA4 antes do POST, evitando duplicados.
- POST container web Entrepontos; POST propriedade GA4 entrepontos.club,
  timezone Europe/Lisbon, currency EUR; POST stream web https://entrepontos.club.
- Validar por GET que os recursos têm o domínio/parent corretos; registar IDs públicos.
- Tentar versions:live do novo container antes de qualquer configuração;
  404 de container novo é evidência de que não há versão publicada.
- Não criar tags, não publicar, não instalar snippet nem gerar hits nesta fatia.
- Permissão insuficiente: registar HTTP/razão sem conteúdo sensível; não escalar escopos
  de acesso da identidade nem reutilizar propriedade/container de outro tenant.
- Rollback: eliminar apenas o container criado e colocar na lixeira apenas a nova
  propriedade, após confirmar IDs e ausência de alterações concorrentes. Stream
  pertence à nova propriedade. Nenhuma restauração de recurso partilhado necessária.
- Evidência: IDs retornados, GET de verificação, estado de versão live, erros sanitizados.

Ajustes transversais exigidos para as próximas fatias: baseline de decole e
product-engineer, reversão seletiva perante alterações concorrentes, verificar
encaminhamento hello@ e 403 Brevo, definir captura/consentimento e excluir PII de
tracking, teste DOI com endereço controlado e isolamento entre listas, catálogo
com updatedAt e validação JSON, GTM live/diff/compilação/export, verificar domínio
Cloud Run. Turnstile é decisão explícita opcional. Não considerar estes pontos resolvidos.

### Revisão independente da fatia Google — 2026-10-16

Planning Review: APROVADO. Revisor separado do implementador confirmou que o
ajuste acima incorpora os requisitos aplicáveis à criação isolada de recursos.
Escopo aprovado: container Web na conta GTM 6266094107, propriedade na conta
GA4 346689750 e stream Entrepontos; validação por GET, inventário de versão live
e rollback seletivo. Não inclui tags, publicação, hits, deploy ou mudanças nos
recursos existentes. Autorizações de criação confirmadas pelo utilizador conforme
registo acima. Nenhum MUST-FIX aberto nesta fatia; requisitos transversais continuam
pendentes para as frentes correspondentes. Ledger Google → APROVADO_BUILD com
base nesta revisão documental; recursos externos ainda não validados nem DONE.

### Execução Google e email — 2026-10-16

- Inventário GTM da conta 6266094107 não contém Entrepontos; accountSummaries
  de ambas as contas GA4 também não continha Entrepontos antes da criação.
- POST GTM container Web em accounts/6266094107: HTTP 404,
  `Not found or permission denied.` Nenhum container criado.
  Utilizador solicitado a conceder administração à service account ou criar o
  container e conceder edição/publicação. Não tentar contornar via outra conta.
- Propriedade GA4 criada e confirmada por GET: properties/559324597,
  parent accounts/346689750, timezone Europe/Lisbon, currency EUR.
- Stream Web criado e confirmado por GET:
  properties/559324597/dataStreams/16141562007;
  measurement ID G-HLHGEBP2H0; defaultUri https://entrepontos.club.
- IDs públicos acrescentados em ~/.env.local com sufixo ENTREPONTOS;
  entradas existentes preservadas. Nenhum secret novo gerado.
- Nenhuma tag publicada, site/Workers inalterados, nenhum hit enviado.
- Brevo: repetição com Node fetch + User-Agent retornou HTTP 200;
  hello@entrepontos.club é sender ativo (id 2), domínio authenticated=true,
  verified=true. Os 403 anteriores eram respostas não JSON no cliente Python;
  não atribuir a falha à chave nem alterar permissões Brevo com base nelas.
- MX presente ainda não comprova a regra/destino do encaminhamento.

### Validação independente parcial — 2026-10-16

Slice Validator: BLOCKED, entrega Google parcial. Evidência documental revista:
propriedade/stream GA4 e respetivos GET acima; falha GTM HTTP 404 impede cumprir
o objetivo de container próprio. Ledger atualizado; a alternativa «limitação API
identificada» não equivale à conclusão do onboarding.

Verificação local independente: `git status --short` e `git diff --stat` não
mostram alterações rastreadas em código ou catálogo; existem ficheiros untracked
pré-existentes, incluindo scripts/testes, que não foram alterados nesta revisão.
Ausência de deploy/mutações dos recursos existentes é declaração do registo de
execução, não auditoria externa independente. Não repeti chamadas API nem acedi
a secrets; confirmação dos recursos remotos baseia-se na evidência do operador.
Condição de saída: acesso GTM apropriado ou container disponibilizado pelo titular,
seguido de novo inventário e validação GET. Email permanece incompleto até
encaminhamento e entrega controlada verificados. Nenhuma frente marcada DONE.
- Cloudflare GET email/routing: enabled=true, status=ready, synced=true.
  GET email/routing/rules: regra hello@entrepontos.club enabled=true com ação
  forward para um destino; catch-all existente drop. Nenhuma regra alterada.
  Teste de entrega real ainda não realizado.

### Retoma após ajuste de permissões GTM — 2026-10-16

- Utilizador confirmou ajuste de acesso na conta GTM.
- Repetido inventário antes do POST; container Entrepontos criado e confirmado
  por GET: accounts/6266094107/containers/267346531, GTM-NP5J47NR.
- versions:live devolveu versão inicial 1; Default Workspace é 2.
  A versão inicial existe automaticamente: não assumir 404 para container novo.
- IDs públicos GTM guardados em ~/.env.local com sufixo ENTREPONTOS.
- Criação por API agora funciona nesta conta, validando o ajuste para futuros
  onboardings na mesma conta. Não implica permissões noutras contas Google.
- Nenhuma tag configurada/publicada nesta primeira fatia.

### Validação independente final da fatia Google — 2026-10-16

Slice Validator: DONE, exclusivamente criação isolada dos recursos Google.
Bloqueio anterior resolvido: registo de execução documenta reinventário, POST e
GET do container 267346531 / GTM-NP5J47NR na conta 6266094107 e leitura live
inicial 1/workspace 2. Em conjunto com GET da propriedade 559324597 na conta
346689750 e stream 16141562007 / G-HLHGEBP2H0, satisfaz o aceite desta fatia.
Não há código novo nesta fatia; revisão de qualidade documental sem MUST-FIX.
Limitação mantida: validação dos recursos remotos assenta nos resultados de API
registados pelo operador, sem repetir chamadas que exigem secrets. Verificação
local independente repetida com `git status --short` e `git diff --stat`: sem
alterações rastreadas em código/catálogo; ficheiros untracked alheios preservados.
Ledger Google atualizado para DONE. Não valida tags, deploy, envio de hits nem
onboarding completo; as demais frentes mantêm critérios e dependências próprios.

## Plano de execução restante — 2026-10-16

### Code Quality Review catálogo/Workers — 2026-10-16

Revisor independente: APROVADO COM RESSALVAS para deploy após dry-runs e
pré-requisitos externos. Primeiro exame encontrou Entrepontos colocado em
handlers em vez de tenants; duas falhas reproduzidas na suite shared. Implementador
corrigiu antes de deploy. Revalidação independente: tenants contém entrepontos,
handlers não contém; shared 142/142; ingress 44/44 e typecheck verde;
git diff --check verde. Nenhum MUST-FIX aberto no diff corrigido.

Restrição do redirect a route.type checkout preserva os testes de checkout
existentes e impede devolver URL de confirmação DOI com PII. GA4 somente Web
consentido, sem emit_tracking nas chains Entrepontos, é ajuste aprovado ao plano;
não criar APIsecret nem atestar user-data em nome do utilizador.

Ressalvas para aceite final: dry-run dos três Workers, suite links-redirect e
dispatcher pertinente ao DOI, smokes baseline pós-deploy e teste DOI real ainda
necessários. Adicionar proteção regressiva para SIGN_UP sem emit_tracking no
teste de catálogo (a asserção atual cobre GENERATE_LEAD), antes de fechar a fatia.
Templates avaliados em conteúdo/código; IDs, tag optin e entrega requerem
evidência remota. Não foi feita chamada externa nem acesso a secrets na revisão.

Utilizador autorizou avançar e confirmou captura nome/email + DOI para Mulheres e
Kids, apenas dados do adulto no Kids. Não há checkout/Hotmart/Meta nesta fase.

### Infraestrutura e tracking (slice externo)

- Baseline: sGTM live v24; Entrepontos Web live v1 vazio; domain mappings decole e
  product-engineer Ready=True. Guardar baseline sanitizado, sem tokens Meta.
- Verificação domínio: tentar ativar siteverification.googleapis.com no projeto
  301441274400 (pedido anterior disse API disabled; GET Service Usage 403).
  Se permitido, pedir DNS_TXT para INET_DOMAIN entrepontos.club, acrescentar TXT
  de verificação sem substituir TXT existentes, validar pela mesma service account.
  Se negado, pedir ao utilizador ativação da API; continuar frentes independentes.
- Criar apenas DNS sgtm CNAME ghs.googlehosted.com (DNS only), api e links A
  192.0.2.1 proxied. Abortar se registo conflitante já existir.
- Cloud Run: criar apenas mapping sgtm.entrepontos.club no serviço partilhado
  server-side-tagging/us-central1; aguardar Ready/certificado antes de hits.
- sGTM: criar workspace próprio da live atual, acrescentar apenas Entrepontos nas
  duas LTs host→tenant e tenant→GA4. Não editar Meta. Comparar entradas antigas,
  rever workspace status, quick_preview, versão e publish; confirmar versions:live.
  Export sanitizado em trafego/gtm, sem valores de secrets Meta existentes.
- Web: padrão googtag + trigger/tag genéricos customEvent/gaawe, transport_url
  https://sgtm.entrepontos.club, campos allowlist produto/product_code/tenant_id;
  nunca email/nome/PII. Publicar após diff/preview. Snippet só após consentimento
  analytics no site; sem network Google quando recusado/antes da escolha.
- GA4: criar apenas API secret do stream Entrepontos (guardar em ~/.env.local),
  dimensões tenant_id/produto/product_code se necessárias ao dashboard.
- Aceite: GETs, DNS, mapping Ready e smokes sGTM, live versions e export sanitizado;
  validar eventos no Realtime somente com consentimento de teste.

### Email, catálogo e Workers (slice cross-module)

- Reutilizar sender hello@entrepontos.club, listas Mulheres2/Kids4. Criar atributos
  LEAD_ID e EP_MULHERES/EP_KIDS_FUNIL_* se ausentes; templates DOI separados
  com params.DOIurl e tag optin; só criar, nunca enviar campanhas.
- Catálogo: acrescentar tenant entrepontos com domains/api/links + allowedOrigins
  apex/www; produtos ENTREPONTOS_MULHERES e ENTREPONTOS_KIDS com listas2/4,
  templates reais, funnelPrefix curto EP_MULHERES/EP_KIDS, evento GENERATE_LEAD
  e SIGN_UP seguindo product-engineer (DOI identity), PAGE_VIEW/CTA_CLICK.
  Atualizar updatedAt. Sem inventar IDs nem incluir credenciais reais.
- Secrets Store: nomes brevo_api_key_entrepontos, sgtm_endpoint_url_entrepontos,
  ga4_measurement_id_entrepontos, ga4_api_secret_entrepontos; bindings nos mesmos
  workers do Product Engineer. Dashboard requer GA4 property/service account e
  ADMIN_SECRET_ENTREPONTOS no Pages; rever repo dashboard antes de mexer.
- Wrangler routes api/links; JSON validação, testes catalog resolver/ingress/links,
  dry-run dos workers afetados antes de deploy; deploy apenas destes workers.
- Aceite: tenant resolvido, CORS aceita apex/www e rejeita terceiros, produto/lista
  isolados, DOI token sem PII, zero regressão smoke decole/product-engineer.

### Site e validação (slice código)

- Repositório entrepontos: preservar conteúdo/links Instagram; adicionar captura
  nome/email/consentimento específico para novidades do público selecionado,
  sem campos de criança. Política privacidade factual (Entrepontos/Elizete Fazza,
  hello@, finalidade e cancelamento via email), sem alegar certificações/prazos.
- Analytics opt-in separado do formulário, recusa tão acessível como aceitação,
  preferência persistida e alterável no rodapé. Form funciona com analytics recusado.
- Form envia apenas para api tenant/produto allowlisted. Dados pessoais só no POST
  necessário ao funil; não em URL/dataLayer. Eventos e atribuição via allowlist.
- Confirmação por público sem ecoar query strings; rid consumido pelo backend.
- Testes antes do código: payload produto/lista e ausência PII em analytics,
  consent gate, erros/sucesso submit; HTML/JS válidos e browser desktop/mobile.
- Teste real só com endereço controlado pelo operador: enviar DOI solicitado no
  onboarding, confirmar manualmente se necessário; verificar lista correta e
  ausência da outra inscrição. Não tocar contactos existentes.
- Não commit/push automático do site sem validação/revisão; para publicar só
  alterações próprias após revisão, nunca incluir untracked/modificados alheios.

### Rollback e concorrência

Registar versions/deploy IDs/ficheiros antes de cada mutação. Só remover recursos
novos Entrepontos (DNS/mapping/secrets/templates/atributos). Reverter entradas
próprias catálogo/site/bindings. Antes de restaurar Worker/GTM inteiro verificar
se há alterações posteriores de terceiros; nesse caso fazer reversão seletiva.
Preservar MX/DKIM, contactos/listas existentes e políticas já configuradas.
Suspender deploy se baseline terceiros falhar. Testes de email com dados controlados
são evidência própria; não apagar inscrições existentes. Turnstile opcional e
recomendado, apenas se API permitir criar widget para o domínio.

### Revisão independente da execução restante — 2026-10-16

Planning Review: APROVADO COM AJUSTES, incorporados abaixo como condições de
execução. Infra/tracking, email/catálogo/Workers e site podem iniciar de forma
independente dentro das dependências indicadas; nenhuma frente está DONE.

- Service Usage: é permitido tentar enable de Site Verification no projeto
  identificado sem alterar IAM/escopos. Negação implica registar bloqueio e pedir
  ativação manual; não bloqueia catálogo, templates e implementação local do site.
- Ordem de publicação: recursos Brevo/IDs reais precedem catálogo; bindings e
  catálogo validados precedem deploy Workers; API funcional e DOI configurado
  precedem publicação do formulário; mapping Ready e LTs verificadas precedem
  eventos live. Ler live imediatamente antes de publicar e abortar perante drift
  inesperado. Baselines dos dois tenants existentes antes e após cada deploy.
- GA4 automático também pode transmitir page_location/page_referrer. Sanitizar
  URLs e desativar captura automática de formulários/enhanced measurement que
  possa recolher PII; confirmação não carrega rid/query no URL enviado ao Google.
  Verificar Network, incluindo page_view automático, e não apenas dataLayer.
- Consentimento retirado deve impedir eventos seguintes e remover cookies
  analytics próprios conhecidos quando aplicável; formulário continua independente.
- Antes da implementação nova, registar comandos efetivos de testes/build/dry-run
  encontrados nos package.json dos módulos afetados e evidência Red/Green; não
  considerar apenas JSON sintaticamente válido como validação do catálogo.
- Rollback de atributos/templates novos só os elimina quando não houver dados ou
  dependências criadas entretanto; após captura real, desativar fluxo e preservar
  contactos, consentimentos e atributos em vez de apagar dados para reverter.
- Dashboard é subfrente separada: ler AGENTS/runbook e confirmar autenticação e
  consultas isoladas antes de implementação/deploy; revisão específica se houver
  código ou contrato novo. Não publicar alterações alheias do worktree.
- Teste DOI exige endereço controlado identificado, comparação das listas antes
  e depois e verificação de que contacto sem confirmação não entra na lista final.
  Falta de confirmação humana mantém aceite pendente, sem contornar DOI.

Sem MUST-FIX de planeamento aberto para iniciar nos limites acima. Permissões,
certificado, entrega DOI e validações independentes continuam gates observáveis,
não promessas de conclusão. Não foram feitas chamadas externas nem lidos secrets
durante esta revisão.

### Execução intermédia — DNS/Brevo/catálogo

- DNS criados: sgtm CNAME (bbdbe826ecdc3be0d7a5ddbd845dca7f), api A proxied
  (7786e1f8ceda70f90907905a6f20b3f1), links A proxied (bb32f970085d9533923e61acae285ab9).
- Baseline antes de deploy: decole e product-engineer sgtm400, linkshealth200,
  api CORS204. sGTM live24, Web Entrepontos live1.
- Brevo atributos LEAD_ID + EP_MULHERES/EP_KIDS_FUNIL_STEPS/LAST_STEP/
  LAST_STEP_TIMESTAMP criados. Templates DOI Mulheres1/Kids2, ativos e tag optin
  confirmados por GET; listas existentes2/4 preservadas.
- Secrets Store: brevo_api_key_entrepontos, sgtm_endpoint_url_entrepontos,
  ga4_measurement_id_entrepontos criados. Nunca registados valores.
- GA4 APIsecret não criado: exige atestado de recolha de dados. Não atestar em
  nome humano; remover emissão server GA4 de SIGN_UP neste tenant para respeitar
  analytics recusado. Conversão DOI continua no Event Store; GA4 via Web consentido.
  apiSecretEnvVar/binding retirados do novo tenant. Outros tenants preservados.
- Turnstile create403, widget não criado; proteção opcional pendente.
- API SiteVerification ativada pelo utilizador; token DNS obtido e TXT acrescentado
  (d3191a7c4c6c8d380eb90195e1418822); verificação inicial pendente propagação DNS.
- Catálogo: teste de isolamento Red2/2 antes, Green2/2 após entrada tenant.
  Ingress: Red2 para redirect indevido DOI com PII; find restringido a type checkout,
  suite completa passou após correção. Shared suite142/142 passou.

### Subfrente dashboard — plano específico

- Leitura AGENTS e auth/queries confirmada: segredo dinâmico ADMIN_SECRET_{TENANT},
  queries parametrizadas com tenant. Não alterar modelo de sessão.
- UI tem PRODUCTS fixos da DECOLE. Criar config pública derivada deste catálogo
  em mkt-dashboard/config/tenant-products.json (tenant/name/products e hasCheckout),
  helper puro que retorna opções só do tenant, normaliza filtro inválido para ALL.
  Testes Red/Green tenant isolation; não colocar tokens/env secrets no config.
- Página dashboard usa helper/config para filtros; para tenants sem checkout mostra
  visitas/cliques/leads/confirmações DOI em vez de checkout/compras/Meta. DECOLE
  mantém comportamento anterior. Não mudar queries/dados existentes.
- dashboard-sync hoje resolve credenciais apenas como strings; para esta frente
  usar Worker secrets GA4_SERVICE_ACCOUNT_KEY_ENTREPONTOS e
  GA4_PROPERTY_ID_ENTREPONTOS, sem novos bindings Secrets Store (não lidos pelo
  código atual). Não mudar runtime de sync dos tenants existentes nesta tarefa.
- Criar ADMIN_SECRET_ENTREPONTOS aleatório apenas em ~/.env.local e CF Pages.
  Atualizar config de produção via PATCH preservando todas as outras env vars;
  deploy dashboard revisto (worktree sem alterações de terceiros rastreadas).
- Validar unit auth/queries/helper, build Next e pages, login correto/incorreto,
  acesso só Entrepontos e sync filtrado; sem imprimir cookie/senha/privatekey.
- Rollback: reverter apenas novo helper/config/página e secret Entrepontos se não
  houver dados capturados; preservar dados D1. Registar deployments anteriores,
  não fazer rollback inteiro se drift concorrente existir.

### Planning Review dashboard — 2026-10-16

Revisor independente: APROVADO COM AJUSTES incorporados neste bloco. Pode
implementar a subfrente descrita, mantendo auth e contratos de queries existentes.
Config derivada deve ser allowlist pública explícita, sem copiar objeto catálogo
inteiro; teste de geração/comparação evita drift entre catálogo e ficheiro público.
Resolver tenant do contexto autenticado; filtro de produto nunca amplia tenant.
Testar ALL, produto alheio, tenant desconhecido e duas sessões de tenants distintos.
Não apresentar ausência de integração Meta/checkout como valores zero de vendas;
ocultar esses indicadores para Entrepontos. Confirmações devem identificar a fonte
Event Store e não alegar GA4 sign_up, ainda ausente; conferir semântica de SIGN_UP
válido/identificado antes de rotular a contagem como DOI confirmado.
PATCH de configuração Pages exige inventário/backup sanitizado e comparação dos
nomes/tipos das env vars antes/depois; não reenviar placeholders de secrets mascarados
nem substituir valores existentes. Se API não permitir preservar secrets de forma
comprovada, usar operação específica de secret em vez de PATCH amplo.
Review de código independente e build/tests precedem deploy. Smokes autenticados
dos tenants existentes e Entrepontos precedem DONE; preservar cookies fora dos logs.

Complemento site: operador reportou GTM draft send_page_view=false e campos ep_*
na googtag; Enhanced Measurement desativado por PATCH+GET. Isto satisfaz ressalva
de configuração em draft; confirmar novamente live e Network após publicação.
SIGN_UP GA4 permanece limitação documentada, sem afetar o DOI no Event Store.

### Publicação e validação integrada — 2026-10-16

- Site publicado diretamente no projeto Pages `entrepontos`: deployment
  ec4ac98c (preview ec4ac98c.entrepontos.pages.dev), produção apex/www.
  GET /, /kids/, /confirmado/, /kids/confirmado/, /privacidade/, /funnel.js:200.
- Workers publicados após dry-run e review:
  dispatcher 86d780a2-6d4d-4046-a337-18465a0c0235 (antes65960109-8cf4-4a2e-9184-c5f8a4ddc529),
  links d863f169-2d04-4689-8650-7853dda3d9d7 (antes3a01498a-b979-461c-8e39-a3231c3f4d11),
  ingress 37274a24-68ce-48a5-adbc-89e7e5249575 (antes7eafdb53-81d9-441c-9bb4-a9ff8161298b).
- Smokes pós-deploy nos 3 tenants: linkshealth200; CORS válido204, inválido403.
  Nenhum formulário de contactos existentes submetido como teste.
- Tests: shared142/142, ingress44/44, links84/84, dispatcher222passed/3skipped
  (skips existentes), dashboard-sync24/24 e typecheck; dashboard49/49 + next/pages build.
- CUA local: formulário Mulheres com fetch simulado202 e analytics recusado funciona;
  retirada consentimento dá reload e0pedidos tracking depois; Kids390px mostra só
  adulto/email, erro de rede preserva campos e reativa botão. Interceções de teste
  removidas e viewport restaurado. Nenhum email fictício enviado à API real.
- Dois testes DOI reais, autorizados pelo utilizador, aliases da caixa principal:
  eventIDs a2445cfa-e768-4598-b8e6-927aee488332 (Mulheres),
  50805f70-99fa-44ed-bffc-087d9e671403 (Kids). Endereços não inscritos antes.
  Ambos delivered pela Brevo; listIds=[] antes de confirmar. Utilizador confirmou
  ambos emails. GET posterior: Mulheres listIds=[2], Kids listIds=[4], ambos
  DOUBLE_OPT-IN=1; ausência da lista oposta. Dados de teste preservados.
- D1: um GENERATE_LEAD e um SIGN_UP por produto, cada um com email_hash preenchido;
  pedidos mantêm consent=true e consent_version=2026-10-16 em payload_json.
- SiteVerification realizada pela service account após ativação manual da API;
  domain mapping sgtm.entrepontos.club criado. Google Ready=True e
  CertificateProvisioned=True desde10:37:31UTC (11:37:31Lisboa). Contudo
  TLS ainda ECONNRESET/ERR_CONNECTION_CLOSED no smoke às11:42Lisboa.
  Não confundir readiness da API com disponibilidade observada no browser.
- sGTM publicado live25 (baseline24), apenas LT19/LT20 alteradas; todas as entradas
  antigas preservadas por comparação estrutural. Export server sanitizado no repo,
  variável de tokens CAPI redigida por inteiro. Web tem draft revisto e compilado,
  ainda live1 enquanto HTTPS smoke falhar; não declarar GA4 funcional.
- GA4 enhanced measurement desativado por PATCH e GET (todos boolean defaultsfalse);
  Web draft googtag send_page_view=false, ep_page_location/referrer/title sanitizados.
- Dashboard: projeto real Pages é `decole-dashboard` (não `mkt-dashboard` do runbook),
  URL dashboard.decolesuacarreiraesg.com.br. Deployment f919c566 (antes
  2a27ccc5-112e-4621-9445-88f28153b06e). ADMIN_SECRET_ENTREPONTOS criado por
  operação nomeada wrangler; GET confirmou todas as env keys anteriores preservadas.
  Senha apenas em ~/.env.local, nunca em docs/logs.
- Dashboard snapshot público corresponde exatamente à projeção allowlist do catálogo.
  Filtros resolvidos por sessão; query produto de outro tenant normaliza para ALL.
  Login correto307+cookie HttpOnly/Secure; senha errada307/login?error=1 sem cookie;
  painel200 com opções Mulheres/Kids, sem filtros DECOLE. Acessos à confirmação
  rotulados sem taxa DOI e com ressalva de que opt-in é comprovado na Brevo.
- Sync: string secrets GA4_ENTREPONTOS configurados porque runtime atual não resolve
  SecretsStore no sync; Worker publicado4ebf42bd-659d-4d7c-88e9-5b8089835fe2
  (antes3e5cbe10-4ed3-4872-afe3-072db919a1d0 após secrets). Typecheck corrigido
  com name?:string no subset de produto, sem runtime novo. Proxy autenticado painel
  executou sync filtrado GA4/Entrepontos200, run_id sync-1792147234266.
- Sem commit/push nesta execução. Deploys diretos foram feitos só após revisão/testes;
  alterações de fontes permanecem locais. Alterações pré-existentes preservadas.

### Slice Validation integrada parcial — 2026-10-16

Revisor independente confirma DONE para Email, Catálogo/funis, Site funcional e
Dashboard. Evidência: reviews anteriores e testes locais independentes (shared142,
ingress44/typecheck, site3, dashboard49), suites/builds/dry-runs registados pelo
operador, deploy IDs, smokes e DOI delivered/confirmado pelo utilizador com listas
2/4 isoladas e D1 com consentimento. Dashboard usa rótulo de acessos, não taxa DOI.
Fecho Site cobre captura e preferência; funcionamento analytics é aceite separado.

Export server-v25 revisto sem imprimir valores: JSON válido, variável de tokens
marcada redigida, nenhuma assinatura private key/Google API key/Bearer encontrada.
Três matches heurísticos de prefixo Meta estavam em dados binários/base64 do
customTemplate, não em valores de configuração de credenciais. Scan é heurístico,
não substitui comparação estrutural sanitizada reportada pelo operador.

Limitação da revisão remota: não houve novas chamadas autenticadas nem leitura de
secrets; estado externo baseia-se nos resultados registados pelo implementador.
Infraestrutura/tracking permanece BLOCKED: mapping Ready não substitui TLS observado;
Web live1 e GA4 sem evento comprovado impedem DONE. Condição de saída registada
no ledger. Não foi marcado onboarding completo; contactos e recursos preservados.
- Browser público https://entrepontos.club/kids/: após reload sem escolha, captura
  Network0requests googletagmanager/google-analytics/sgtm; recusa funciona e
  formulário visível. Prova visual guardada fora do repo para entrega ao utilizador.
- Runbook atualizado com lições verificadas: permissão GTM de conta, SiteVerification,
  projeto Pages real, sync credenciais string, consent tracking, filtros por tenant,
  aliases Gmail e readiness vs HTTPS real. Não alterar outros tenants para contornar
  a propagação HTTPS do novo domínio.

### Fecho desta execução — pendência externa

- Janela adicional limitada de20smokes HTTPS, intervalos30s: todas falharam com
  ECONNRESET. Processo de polling terminou; não há publicação automática pendente.
- Web GTM permanece live1 (vazia); draft2 preservado, preview compila e regex
  verificada (gtm.js/load excluídos, page_view/generate_lead aceites). GA4 Realtime
  não validado e tracking não declarado operacional.
- Para retomar: smoke real HTTPS/g/collect400 → confirmar live1 sem drift e diff9
  entidades → quick_preview → criar/publicar Web → confirmar live/export → teste
  browser consentido com ep_* sanitizados em Network e GA4 Realtime → syncGA4 →
  Slice Validator da última frente. Atualizar workspaceId local após publish se
  o GTM remover/recriar o workspace; nunca reusar ID eliminado.
- Não usar HTTP como transporte de analytics nem desligar validação de certificados.
  Manter formulários/DOI operacionais independentemente da pendência de tracking.
- Scan final export0padrões de secrets após redação de tokens embutidos também nos
  customTemplate.templateData; export sanitizado não deve ser importado como backup
  completo. Nenhum valor sensível incluído nas saídas de revisão/relatório.
