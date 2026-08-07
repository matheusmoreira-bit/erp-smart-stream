# Limpeza de alertas de segurança — plano de 1 semana

Objetivo: revalidar todos os alertas (inclusive os ignorados desde o início do projeto), manter ignorados só os que realmente fazem sentido e zerar o resto sem interromper o uso do sistema.

## O que foi verificado agora (estado real)

- Scanner persistido: 3 achados abertos, todos nível `warn`
  - `pagcorp_card_mapping`: política de admin no papel `public` em vez de `authenticated`
  - `permissions_enforcement_scope`: duas políticas no papel `public`
  - Um achado informativo dizendo que a visibilidade operacional ampla é intencional (não exige ação)
- Linter do banco: 105 apontamentos, sendo
  - 3 tabelas com RLS ligado e nenhuma policy: `auth_caller_cache`, `edge_rate_limits`, `expense_audit_log` (uso exclusivo de backend)
  - 1 extensão no schema público: `pg_trgm`
  - ~100 avisos de funções `SECURITY DEFINER` executáveis: 85 funções no total, 45 executáveis por `anon` e 56 por `authenticated`
- Nenhuma tabela do schema `public` está sem RLS
- Todas as 85 funções `SECURITY DEFINER` já têm `search_path` fixado
- 21 policies ainda usam o papel `public` em vez de `authenticated`
- CORS: o helper de allowlist (`cors-allowlist`) já é usado por 38 edge functions; cerca de 70 ainda respondem com `Access-Control-Allow-Origin: *`
- Dependências (npm audit): sem vulnerabilidades altas/críticas

Sobre os itens ignorados: a lista de achados ignorados só pode ser reaberta por você, na aba Security do projeto. Eu não consigo "designorar" — por isso a revalidação começa por você reativar todos e eu reclassificar um a um.

## Princípio para não quebrar o sistema

Nenhuma mudança remove acesso de quem já usa. A regra é: primeiro medir quem chama o quê, depois restringir, sempre em lote pequeno e reversível. Tudo que restringe papel/permissão entra com verificação prévia de uso real (logs das edge functions e das chamadas ao banco) antes de aplicar.

## Cronograma (5 dias úteis)

**Dia 1 — Revalidação dos ignorados**
- Você reabre todos os achados ignorados na aba Security
- Reclassificação de cada um em: corrigir agora, corrigir no plano, ou ignorar de forma justificada
- Reescrita da memória de segurança para refletir só os riscos realmente aceitos (visibilidade operacional compartilhada, tabelas de cache internas, etc.)
- Entrega: lista final com o motivo de cada item mantido ignorado

**Dia 2 — Políticas RLS no papel correto (risco baixo)**
- Trocar `public` por `authenticated` nas 21 policies que hoje avaliam papel público, mantendo exatamente a mesma condição de acesso
- Exceções checadas antes: `enabled_erp_types` e as policies de `service_role`, que continuam como estão
- As 3 tabelas sem policy (`auth_caller_cache`, `edge_rate_limits`, `expense_audit_log`) ganham policy explícita de "somente backend", documentando a intenção e silenciando o alerta
- Verificação: abrir aprovações, despesas, PagCorp e cadastros com um usuário comum e um admin

**Dia 3 — Superfície das funções SECURITY DEFINER (maior volume)**
- Inventário das 85 funções separando: usadas pelo frontend, usadas só por edge function/cron, e órfãs
- Revogar `EXECUTE` de `anon` em tudo que não precisa de acesso anônimo (hoje são 45 funções; a expectativa é sobrar quase nada, já que o app exige login)
- Revogar `EXECUTE` de `authenticated` nas funções que só o backend chama (métricas, prune, sync, auditoria)
- Aplicado em 3 lotes, com teste de fumaça entre eles
- Verificação: aprovações, feed, notificações, cadastros e telas de backoffice

**Dia 4 — CORS e cabeçalhos**
- Migrar as ~70 edge functions restantes para o helper de allowlist (mesmo padrão já usado nas 38 atuais), incluindo o `_shared/employee-sync`
- Revisar CSP/HSTS e demais cabeçalhos do app publicado
- Verificação: fluxos que chamam funções a partir do domínio próprio e do preview

**Dia 5 — Fechamento**
- Mover `pg_trgm` para o schema `extensions` (checando os índices que dependem dela; se houver risco de indisponibilidade, fica registrado como risco aceito em vez de mexer)
- Rodar novamente scanner + linter + `npm audit`
- Marcar como corrigidos os achados resolvidos e publicar o relatório final com GO/NO-GO

## Detalhes técnicos

- Todas as mudanças de banco vão em migrações pequenas e independentes, uma por tema (policies, grants de função, extensão), para permitir rollback isolado.
- `ALTER POLICY ... TO authenticated` não altera a expressão `USING`/`WITH CHECK`; o efeito prático é apenas deixar de avaliar a regra para requisições anônimas.
- Revogações seguem o padrão `REVOKE EXECUTE ON FUNCTION public.<fn>(<assinatura>) FROM anon;` — assinatura completa, porque há funções sobrecarregadas (`check_applicable_approval_rules`, `find_open_registration_duplicate`).
- Funções chamadas por edge function com `service_role` não são afetadas por revogação de `anon`/`authenticated`.
- Nas edge functions, o CORS passa a devolver o cabeçalho só para origens da allowlist; a resposta de `OPTIONS` continua existindo em todas.
- Nada de mexer em `verify_jwt`, chaves ou schema de auth neste plano.

## Riscos

- Revogar `EXECUTE` de uma função que o frontend usa quebra a tela correspondente. Mitigado pelo inventário do Dia 3 e pelos lotes com teste entre eles.
- Mover `pg_trgm` pode exigir recriar índices de busca; se o custo for alto, o item é registrado como risco aceito e não executado.
