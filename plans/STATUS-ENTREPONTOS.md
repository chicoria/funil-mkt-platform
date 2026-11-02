# STATUS — Onboarding Entrepontos

Plano: [entrepontos-2026-10-16.md](onboardings/entrepontos-2026-10-16.md).

| Fatia | Critério de aceite | Evidência exigida | Status |
|---|---|---|---|
| Google recursos | Container Web e propriedade/stream próprios; sem tags/deploy | GET/POST sanitizados e IDs verificados | DONE |
| Email | Sender ativo e autenticação/encaminhamento verificados | APIs e DNS; entrega DOI real controlada | DONE |
| Catálogo/funis | Dois públicos isolados com recursos reais | JSON, testes, D1 e listas DOI isoladas | DONE |
| Infraestrutura/tracking | sGTM HTTPS e tracking Web/GA4 operacionais sem regressões | TLS, versões live, Network/Realtime e smokes dos 3 tenants | BLOCKED |
| Site funcional | Captura/consentimento e confirmação funcionais; analytics validado separadamente | Interação, ausência PII e teste DOI | DONE |
| Dashboard | Filtros por tenant, login e sync Entrepontos operacionais | 49 testes, builds e smokes autenticados | DONE |

Apenas Slice Validator independente atualiza status e fecha fatias.

2026-10-16 — Validação independente documental: GA4 properties/559324597 e
stream 16141562007 registados como criados/confirmados por GET no plano.
GTM POST accounts/6266094107 retornou 404 `Not found or permission denied.`;
container Web permanece ausente. Saída do bloqueio: acesso adequado confirmado
ou container criado pelo titular e partilhado com a identidade operadora;
reinventariar antes de repetir criação. Não marcar DONE com a entrega parcial.

2026-10-16 — Bloqueio Google resolvido após ajuste de acesso pelo utilizador.
Slice Validator independente: DONE para recursos isolados, com base documental
nos GET registados no plano: container 267346531 / GTM-NP5J47NR, live inicial 1,
workspace 2; GA4 property 559324597, stream 16141562007 / G-HLHGEBP2H0.
Esta conclusão não inclui configuração de tags, publicação nem tracking funcional.

2026-10-16 — Planning Review restante APROVADO COM AJUSTES incorporados no
plano, secção «Revisão independente da execução restante». Operações independentes
podem iniciar; dependências locais de publicação/aceite continuam obrigatórias.
Dashboard exige leitura das suas instruções e revisão específica antes de deploy.

2026-10-16 — Slice Validator independente: Email, Catálogo/funis, Site funcional
e Dashboard DONE com base nos testes/reviews locais e evidência integrada descrita
no plano. Infraestrutura/tracking BLOCKED: TLS sgtm ECONNRESET apesar de Ready,
Web live1, sem comprovação de eventos Realtime. Saída: HTTPS observado funcional,
publicação Web revista e eventos consentidos sem PII em Network/GA4 Realtime,
com smokes dos tenants existentes. Onboarding completo ainda não concluído.
