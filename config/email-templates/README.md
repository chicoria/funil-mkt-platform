# Email Templates (Local Source)

Este diretorio guarda os templates de email versionados no repositorio.

Objetivo:
- permitir revisao de conteudo no Git
- manter historico de alteracoes
- mapear claramente template local <-> template Brevo

Regras:
1. Sempre atualizar `products.catalog.json` com `localFile` e `version`.
2. Template no Brevo e gerenciado manualmente no dashboard.
3. Alteracao no HTML local deve ser replicada no Brevo e registrada no mesmo PR.
4. Nao incluir secrets, tokens ou dados pessoais reais nos templates.

Estrutura:
- `decole-esg/`
- `planovoo/`
