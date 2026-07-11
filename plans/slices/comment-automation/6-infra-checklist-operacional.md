# Slice 6 — Infra + checklist operacional (sem TDD — operacional)

Status: IN_PROGRESS

## Objetivo e problema

Última peça do plano: criar os recursos Cloudflare reais que os Slices 4 e
5 já referenciam declarativamente (`wrangler.toml` de cada worker), fazer
deploy dos 2 workers, e completar o checklist manual no painel da Meta
(inscrição de webhook). Sem TDD — é trabalho operacional/infra, não código
novo.

## Decisão de processo: confirmação individual por passo

Diferente dos Slices 1-5 (código, em git, reversível por `git revert`),
este slice cria **estado real fora do repositório** — recursos Cloudflare
de produção e credenciais reais no Secrets Store. Cada ação não-trivial-
mente-reversível deste slice é confirmada individualmente com o usuário
antes de execução, em vez de uma autorização única no início do slice.

## Escopo dentro

1. **Fila + DLQ**: `decole-q-social-events` (+ `decole-q-social-events-dlq`).
2. **KV namespace**: para o binding `SOCIAL_DEDUPE_KV` (Slice 5).
3. **Secrets Store**: promover/criar os 3 secrets já referenciados nos
   `wrangler.toml` dos Slices 4/5:
   - `META_APP_SECRET_DECOLE` (já existe em `.env.local`, promover).
   - `META_SYSTEM_USER_ACCESS_TOKEN_DECOLE` (já existe em `.env.local`,
     promover).
   - `META_WEBHOOK_VERIFY_TOKEN_DECOLE` (**gerar agora** — string
     aleatória nossa, não vem da Meta).
4. **Deploy** dos 2 workers (`api-social-ingress`, `social-dispatcher`).
5. **Checklist manual** (fora de código, painel da Meta):
   - Inscrever a Página no campo de webhook `feed` (comentários).
   - Inscrever a conta Instagram no campo `comments`.
   - Registrar URL de callback (`https://api.decolesuacarreiraesg.com.br/webhooks/v1/meta`)
     + verify token no painel do App Meta.
   - Confirmar na doc atual da Meta a janela de tempo pra private reply.
   - Confirmar rate limits da Graph API pro volume esperado.
6. **Teste real**: comentar a palavra-chave configurada (`tradução`) num
   post real conectado, confirmar reply público + DM privada chegando.

## Escopo fora

- Qualquer mudança de código (Slices 1-5 já fechados).
- Qualquer novo tenant/produto — só `decole`/`DECOLE_PLANOVOO`, mesmo
  escopo já decidido desde o plano-mestre.

## Limitação conhecida, já registrada (não bloqueia, mas afeta o teste real)

O ledger (`plans/STATUS-COMMENT-AUTOMATION.md`, entrada do Slice 3)
registra um gap de permissão: falta `pages_messaging` no token pra private
reply **no Facebook** — Instagram deve funcionar
(`instagram_manage_messages` presente). O teste real (item 6) pode
confirmar ou refutar isso; se a private reply do Facebook falhar, não é
bug do dispatcher (Slice 5 já trata isso como erro retryável esperado).

## Critério de aceite

Comentário real num post conectado → reply público aparece no comentário
+ DM privada chega na caixa de entrada do Instagram/Messenger, dentro da
janela do Meta.

## Rollback

- Deploy: `wrangler rollback` ou re-deploy da versão anterior (workers
  novos, sem versão anterior real — rollback = não rotear tráfego, já que
  o webhook só é registrado no painel da Meta como último passo).
- Fila/KV: `wrangler queues delete`/remoção do namespace (sem consumidores
  até o deploy, sem perda de dados).
- Secrets Store: remoção do secret (não invalida o token na Meta, só o
  binding local).
- Inscrição de webhook: desinscrever no painel da Meta (reversível a
  qualquer momento, para qualquer page/conta).

## Execução (append-only)

- **2026-06-22:** Slice file criado. `wrangler` autenticado (Account API
  Token, conta `Chicoria@gmail.com's Account`, id `c288163c...`).
