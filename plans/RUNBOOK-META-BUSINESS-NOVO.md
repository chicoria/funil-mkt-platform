# Runbook — Meta para um tenant com Business novo

Passo a passo para pôr a Meta (Business, app, system user, token e pixel) num
Business **próprio** do tenant, sem ter de abrir a app da DECOLE para copiar a
configuração. Feito pela primeira vez em 2026-11-01 para `product-engineer`
([registo](onboardings/product-engineer-meta-2026-11-01.md)). Depois deste
runbook segue a Frente 3c de [RUNBOOK-ONBOARDING-TENANT.md](RUNBOOK-ONBOARDING-TENANT.md)
(GTM Web + sGTM).

Quem faz o quê: o titular cria o Business e escreve a senha quando a Meta pede.
O agente faz o resto pelo Chrome com a sessão do titular, e pela Graph API com o
token novo. O agente nunca escreve senhas e nunca mostra tokens no chat.

## Referência: a app da DECOLE

Não é preciso consultar; fica aqui o que tem.

| | DECOLE |
|---|---|
| App | "DECOLE Agents API", `1561616212633179`, Business `577362448377604`, não publicada |
| Casos de uso | Criar e gerenciar anúncios com a API de Marketing · Gerenciar mensagens e conteúdo no Instagram · Gerenciar tudo na sua Página |
| Produto extra | Login do Facebook para Empresas |
| System user | `agent-api` (`122106250778782480`), token em `META_SYSTEM_USER_ACCESS_TOKEN` |
| Permissões do token | `ads_management`, `ads_read`, `business_management`, `catalog_management`, `read_insights`, `pages_show_list`, `threads_business_basic`, `instagram_*` e outras (24 concedidas em 2026-11-01) |

Um system user pertence a um só Business: o `agent-api` da DECOLE consegue
**ler** outro Business onde o titular é admin, mas não cria ativos lá (#10).
Mover a app da DECOLE para outro Business arrisca o token e o CAPI da DECOLE:
não fazer. Criar uma app por Business.

## 1. Business (titular)

business.facebook.com > criar portfólio empresarial. Registar o ID como
`META_BUSINESS_ID_{TENANT}` em `~/.env.local`. Adicionar como ativos a Página do
Facebook e a conta de Instagram do tenant (Contas > Páginas / Contas do
Instagram).

## 2. App (developers.facebook.com/apps/creation/)

1. **Detalhes**: nome `{Tenant} Agents API` (ex.: "PE Agents API"); email de
   contacto do titular.
2. **Casos de uso**: filtro "Tudo" e marcar os três da DECOLE:
   - Criar e gerenciar anúncios com a API de Marketing
   - Gerenciar mensagens e conteúdo no Instagram
   - Gerenciar tudo na sua Página
3. **Empresa**: escolher o portfólio do tenant (não o da DECOLE).
4. **Requisitos**: "Nenhum requisito identificado".
5. **Visão geral** > "Criar aplicativo": aceita os Termos da Plataforma Meta e as
   Políticas do Desenvolvedor (pedir o sim do titular). A Meta pede a **senha**:
   o titular escreve e clica "Enviar".
6. Registar o ID como `META_APP_ID_{TENANT}`.

A app fica "Não publicada"; para os ativos do próprio Business não precisa de
App Review.

## 3. System user (Business > Configurações > Usuários > Usuários do sistema)

1. "Adicionar". Na primeira vez a Meta mostra a **Política de Não
   Discriminação** de anúncios: "Aceito" (pedir o sim do titular), depois
   "Concluir" e "Adicionar" outra vez.
2. Nome `agent-api-{tenant}` (ex.: `agent-api-pe`), função **Admin**, criar.
3. **Atribuir ativos**, com acesso total em cada um:
   - Apps > a app nova > "Gerenciar app"
   - Páginas do Facebook > a Página > "Tudo"
   - Contas do Instagram > a conta do tenant > acesso total
   A janela às vezes fecha sem guardar: reabrir e conferir em "Ativos
   atribuídos".

## 4. Token do system user

"Gerar token" no system user:
1. **App**: a app nova.
2. **Expiração**: **Nunca** (o padrão é 60 dias; marcar "Nunca" antes de
   avançar).
3. **Permissões**: marcar **todas** as disponíveis (23 em 2026-11-01):
   `ads_management`, `ads_read`, `business_management`, `catalog_management`,
   `facebook_branded_content_ads_brand`, `instagram_basic`,
   `instagram_branded_content_ads_brand`, `instagram_branded_content_brand`,
   `instagram_content_publish`, `instagram_manage_comments`,
   `instagram_manage_contents`, `instagram_manage_insights`,
   `instagram_manage_messages`, `instagram_shopping_tag_products`,
   `pages_manage_ads`, `pages_manage_engagement`, `pages_manage_metadata`,
   `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_content`,
   `pages_show_list`, `read_insights`, `threads_business_basic`.
   A lista é virtualizada; ao marcar por script, conferir `aria-selected`.
4. A Meta avisa que há permissões ainda não adicionadas à app: "Continuar"
   acrescenta-as e aceita os termos.
5. **Guardar sem ver o valor**: clicar "Copiar" e correr

   ```sh
   t=$(pbpaste | tr -d '[:space:]'); case "$t" in EAA*) printf '\nMETA_SYSTEM_USER_ACCESS_TOKEN_{TENANT}=%s\n' "$t" >> ~/.env.local;; esac; printf '' | pbcopy
   ```

6. Confirmar por GET (só leitura): `me?fields=id,name` devolve o system user;
   `me/permissions` conta as concedidas; `{business}/instagram_accounts` vê o
   Instagram.

## 5. Pixel / dataset

Business > Fontes de dados > Conjuntos de dados e pixels > Adicionar. Nome
`{Marca} ({domínio})`, deixar marcada a ligação à API de Conversões, "Criar".
Ler o ID por GET `{business}/owned_pixels` e registar `META_PIXEL_ID_{TENANT}`.

`POST /{business}/adspixels` com o token de uma app nova devolve
`#10 Application does not have permission for this action`: criar pela
interface. (Funciona com a app da DECOLE no Business da DECOLE, como no
Entrepontos.)

Ao criar o dataset, a Meta cria sozinha um "Conversions API System User" com
só ANALYZE. O system user Admin já **lê** o pixel (GET funciona), mas sem
atribuição não tem EDIT/UPLOAD.

**Atribuir o system user ao pixel (interface; feito assim em 2026-11-01).**
`POST /{pixel}/assigned_users` foi recusado pela política de permissões do
agente, por isso pela interface:
1. Business > Configurações > Fontes de dados > Conjuntos de dados e pixels >
   o pixel > separador **Pessoas** > "Atribuir pessoas".
2. Marcar `agent-api-{tenant}` (System user).
3. Ligar **Acesso total — Gerenciar o conjunto de dados de eventos** (liga
   também o acesso parcial) > "Atribuir" > "Concluir".
4. Confirmar por GET `{pixel}/assigned_users?business={business}`: o system
   user com `ADVERTISE, UPLOAD, ANALYZE, EDIT`.

**Test event code.** Events Manager > o pixel > **Eventos de teste** >
"Selecionar o canal" = **Site** > abrir "Confirme se os eventos do seu servidor
estão configurados corretamente": o código `TEST#####` aparece aí. Não é
secreto; registar como `META_TEST_EVENT_CODE_{TENANT}`.

**Token CAPI: não é preciso gerar outro.** Com o system user atribuído ao
pixel, o próprio `META_SYSTEM_USER_ACCESS_TOKEN_{TENANT}` envia eventos CAPI.
Smoke em 2026-11-01: `POST /{pixel}/events` com um `PageView` de teste
(`action_source=website`, `event_id`, `user_data` mínimo) e
`test_event_code` devolveu `events_received: 1`. Esse token vai para a
`LT - Meta CAPI Token by Tenant` do sGTM. Gerar um token CAPI separado no
Events Manager só se se quiser isolar o CAPI do token de gestão.

## 6. Seguir para a Frente 3c

Com o pixel, o token CAPI e o test code: GTM Web do tenant (tags do template
Meta, copiadas da DECOLE), LTs Meta no sGTM, catálogo e smoke.
