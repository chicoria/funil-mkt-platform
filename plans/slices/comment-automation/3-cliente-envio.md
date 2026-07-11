# Slice 3 — Cliente de envio (TDD, fetch mockado)

Status: DONE

## Objetivo e problema

Módulo que efetivamente envia as respostas (pública e/ou DM privada) via
Graph API da Meta, dado um `CommentAutomationRule` já casado (Slice 2) e o
`SocialCommentEvent` original. Última peça antes dos workers (Slice 4/5).

## Achado de pesquisa (Graph API, 2026-06-22)

- **Endpoint unificado FB+IG para reply público:** `POST /{comment-id}/comments`
  com `{ message: "..." }`.
- **Endpoint unificado FB+IG para private reply:** `POST /{comment-id}/private_replies`
  com `{ message: "..." }` — mesmo edge funciona pra `comment_id` de
  Facebook e de Instagram (confirmado contra múltiplas fontes/guias atuais,
  não só doc oficial — a doc oficial da Meta não renderizou conteúdo útil
  via fetch automatizado nesta sessão).
- ⚠️ **Gap de permissão descoberto agora, não antes:** a doc menciona que
  `private_replies` no Facebook historicamente exige `read_page_mailboxes`
  (nome antigo) ou, em versões mais recentes da API, `pages_messaging`.
  **Nenhuma dessas duas aparece nos scopes do `META_SYSTEM_USER_ACCESS_TOKEN`
  verificados nesta sessão** (scopes confirmados: `pages_manage_engagement`,
  `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts`,
  `instagram_manage_messages`, `instagram_manage_comments`, entre outros —
  sem `pages_messaging`). **Instagram** tem `instagram_manage_messages`,
  que deveria cobrir a private reply do lado IG. Conclusão: reply público
  (FB e IG) e private reply **no Instagram** devem funcionar com as
  permissões atuais; private reply **no Facebook** é incerto e precisa de
  teste real antes de confiar no canal — registrado também no checklist
  operacional do Slice 6.
- Limite de tempo pra private reply: fontes variam ("usually several
  months", sujeito a mudança) — não confiável o suficiente pra hardcodar
  um número; tratar como "verificar na prática se a resposta falhar por
  janela expirada" em vez de validar previamente no código.

## Escopo dentro

- `packages/shared/src/social-send.ts`:
  - `interface DirectMessageRequest { platform: SocialPlatform; commentId: string; message: string; accessToken: string; fetchImpl?: typeof fetch }`
  - `interface CommentReplyRequest` (mesmo shape, semântica de reply público).
  - `replyToComment(req: CommentReplyRequest): Promise<void>` —
    `POST https://graph.facebook.com/v21.0/{commentId}/comments`, body
    `{ message }`, `access_token` como query param (convenção Graph API).
  - `sendDirectMessage(req: DirectMessageRequest): Promise<void>` —
    `POST https://graph.facebook.com/v21.0/{commentId}/private_replies`,
    mesmo body/auth. Platform recebido só pra log/erro — endpoint é o
    mesmo pros dois (não há switch real de implementação por platform,
    diferente do que o plano-mestre original assumia; ajuste registrado
    aqui).
  - Stub documentado (comentário, não função real) pro WhatsApp futuro:
    `// sendWhatsAppMessage(req): endpoint e payload diferentes (Cloud API,
    /{phone_number_id}/messages) — implementar quando WhatsApp entrar,
    sem alterar a assinatura de DirectMessageRequest se possível.`
  - Erro em resposta não-2xx: lança `Error` com corpo da resposta. Leitura
    do corpo **tolerante a falha** (`.catch(() => "")`, estilo
    `callProductApi`) + **truncada em 300 chars** (estilo `postJson`) —
    combina as duas propriedades de segurança dos dois padrões existentes
    (achado do Planning Review: a escolha entre os dois estilos estava
    aberta, fixada agora). Não-fatal é decisão do *handler* que chama,
    não desta função.
  - Versão da Graph API (`v21.0`) **hardcoded na URL por agora** — aceitável
    pra v1; não vem de catalog/env (achado do Planning Review, registrado
    como simplificação conhecida, não MUST-FIX). Revisitar se precisar de
    rollover de versão sem redeploy.
  - `fetchImpl` injetável (default `fetch` global) — é o que permite
    mockar em teste sem `vi.mock` global.

## Escopo fora

- Nenhum handler de dispatcher (Slice 5).
- Nenhuma chamada real à Graph API nos testes — sempre `fetchImpl` mockado.
- Nenhuma implementação real de WhatsApp (só o comentário-stub).

## TDD — testes escritos ANTES da implementação

`packages/shared/test/unit/social-send.test.ts`:
- `replyToComment` — monta URL/método/body corretos pra um `commentId` de
  exemplo; resposta `ok:true` resolve sem erro; resposta não-ok (`ok:false`,
  `status:400`, corpo com erro) rejeita com `Error` contendo o corpo.
- `sendDirectMessage` — mesma bateria, no endpoint `private_replies`;
  testar com `platform:"facebook"` e `platform:"instagram"` (mesma URL nos
  dois, conforme achado de pesquisa — teste deve confirmar isso
  explicitamente, não assumir).
- Confirma que `fetchImpl` é chamado exatamente 1 vez por chamada (sem
  retry automático embutido — retry é responsabilidade de quem chama).

## Critério de aceite

`npx vitest run packages/shared` 100% verde, zero chamada de rede real nos
testes (`fetchImpl` sempre mockado), zero `any`/`!` sem justificativa.

## Rollback

Arquivo novo isolado, sem dependentes ainda — apagar `social-send.ts` +
teste.

## Execução (append-only)

- **2026-06-22:** Planning Review (agente separado) → APROVADO COM AJUSTES.
  Ajustes incorporados: leitura de corpo de erro tolerante a falha
  (`.catch(() => "")`) + truncada em 300 chars; versão `v21.0` registrada
  como hardcoded por decisão (não MUST-FIX).
- **2026-06-22:** TDD Red→Green — `social-send.ts` + teste criados;
  endpoint unificado FB/IG confirmado por teste explícito (mesma URL pros
  dois platforms em `sendDirectMessage`).
- **2026-06-22:** `npx vitest run packages/shared` → 10 arquivos, 121
  testes, todos verdes.

## Revisão (Planning Review / Code Quality Review / Slice Validator)

**Code Quality Review: APROVADO COM RESSALVAS** (agente independente,
rodou `npx vitest run packages/shared` ele mesmo: 10 arquivos, 121 testes
verdes). Zero MUST-FIX. 2 SHOULD-FIX: (1) teste de truncamento de 300
chars verificava só que ficou "menor", não o tamanho exato — **corrigido**
nesta atualização (`toHaveLength(300)` + `toBe("x".repeat(300))`); (2) sem
histórico de commit comprovando ordem Red→Green (arquivos novos
untracked) — aceito como relato textual na seção Execução, conforme
`slice-validation.md` permite "evidência equivalente".

**Slice Validator: DONE** — critério de aceite verificado por execução
própria; URL exata e shape de body testados via `toBe`/`toEqual`, não só
"foi chamado"; endpoint unificado FB/IG confirmado por teste explícito;
zero `any`/`!`; cross-check contra a cadeia de handlers do Slice 5
(`match_comment_rule → reply_to_comment → send_private_reply`) confirma
que `SocialCommentEvent` + `CommentAutomationRule` + token resolvido
mapeiam 1:1 pros parâmetros de `replyToComment`/`sendDirectMessage`, sem
gap de integração.
