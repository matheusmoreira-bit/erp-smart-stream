# Plano de Implementação — Limpeza dos Alertas de Segurança

**Início:** segunda-feira, 10/08/2026
**Término previsto:** sexta-feira, 14/08/2026
**Responsável técnico:** time ERP Flow
**Objetivo:** revalidar todos os alertas de segurança (inclusive os ignorados desde o início do projeto), manter ignorados apenas os que fazem sentido e zerar os demais sem interromper o uso do sistema.

---

## 1. Situação atual (levantada em 07/08/2026)

### Scanner de segurança (achados persistidos)

| Nível | Item | Situação |
|---|---|---|
| warn | `pagcorp_card_mapping` — política de admin no papel `public` | Corrigir (Dia 2) |
| warn | `permissions_enforcement_scope` — 2 políticas no papel `public` | Corrigir (Dia 2) |
| warn | Visibilidade operacional ampla em tabelas internas | Risco aceito, documentar |

### Linter do banco — 105 apontamentos

| Categoria | Qtd | Ação |
|---|---|---|
| Funções `SECURITY DEFINER` executáveis por `anon` | 45 | Revogar (Dia 3) |
| Funções `SECURITY DEFINER` executáveis por `authenticated` | 56 | Revisar e revogar o que for backend-only (Dia 3) |
| Tabelas com RLS ligado e sem policy | 3 | Policy explícita backend-only (Dia 2) |
| Extensão no schema `public` (`pg_trgm`) | 1 | Avaliar mover (Dia 5) |

Tabelas sem policy: `auth_caller_cache`, `edge_rate_limits`, `expense_audit_log` — todas de uso exclusivo do backend, sem grants para `anon`/`authenticated`.

### Verificações que já estão OK

- Nenhuma tabela do schema `public` está sem RLS.
- Todas as 85 funções `SECURITY DEFINER` já têm `search_path` fixado.
- `npm audit`: nenhuma vulnerabilidade alta ou crítica.
- Dependabot e dependency review já ativos no repositório.

### Pontos abertos fora do banco

- 21 políticas RLS ainda usam o papel `public` em vez de `authenticated`.
- CORS: o helper `_shared/cors-allowlist.ts` já é usado por 38 edge functions; cerca de 70 ainda respondem com `Access-Control-Allow-Origin: *`.

### Achados ignorados

A lista de achados ignorados só pode ser reaberta pelo usuário, na aba **Security** do projeto. O agente não consegue reverter um "ignore". Por isso o Dia 1 começa pela reabertura de todos os ignorados, seguida de reclassificação item a item.

---

## 2. Princípio de execução

Nenhuma mudança remove acesso de quem já usa hoje. A regra em todas as etapas:

1. Medir quem chama o quê (logs de edge function, `db_query_metrics`, busca no código).
2. Restringir em lotes pequenos.
3. Testar entre lotes.
4. Manter cada mudança em uma migração isolada, com rollback simples.

Janela de aplicação preferencial: fora do horário de pico de aprovações (antes das 9h ou após as 18h).

---

## 3. Cronograma

### Segunda — Dia 1: revalidação dos ignorados

- [ ] Usuário reabre todos os achados ignorados na aba Security.
- [ ] Reclassificar cada achado em: **corrigir agora**, **corrigir no plano** ou **ignorar com justificativa**.
- [ ] Reescrever a memória de segurança do projeto para conter apenas os riscos realmente aceitos (visibilidade operacional compartilhada, tabelas de cache internas, endpoints públicos por design).
- [ ] Entregável: tabela final com o motivo de cada item mantido ignorado.

### Terça — Dia 2: políticas RLS no papel correto (risco baixo)

- [ ] Migração 1: `ALTER POLICY ... TO authenticated` nas 21 políticas hoje no papel `public`, preservando exatamente as expressões `USING`/`WITH CHECK`.
- [ ] Exceções revisadas antes de aplicar: `enabled_erp_types` (leitura pública por design) e políticas destinadas a `service_role`.
- [ ] Migração 2: policy explícita "somente backend" em `auth_caller_cache`, `edge_rate_limits` e `expense_audit_log`, documentando a intenção e silenciando o alerta.
- [ ] Teste: abrir Aprovações, Despesas, PagCorp, Cadastros e Backoffice com um usuário comum e um admin.

### Quarta — Dia 3: superfície das funções SECURITY DEFINER

- [ ] Inventário das 85 funções em três grupos: chamadas pelo frontend (`supabase.rpc`), chamadas apenas por edge function/cron, e órfãs.
- [ ] Lote A: revogar `EXECUTE` de `anon` em todas as funções que não precisam de acesso anônimo (hoje 45; o app exige login, então a expectativa é sobrar pouco ou nada).
- [ ] Lote B: revogar `EXECUTE` de `authenticated` nas funções exclusivamente de backend (métricas, `prune_*`, sync, auditoria, `record_db_query_metrics`).
- [ ] Lote C: avaliar funções órfãs para remoção futura (sem excluir nesta semana).
- [ ] Teste de fumaça entre cada lote: aprovações, feed, notificações, cadastros e telas de backoffice.

### Quinta — Dia 4: CORS e cabeçalhos

- [ ] Migrar as ~70 edge functions restantes para `corsFor(req)` + `rejectForeignOrigin(req)`, no mesmo padrão das 38 já convertidas.
- [ ] Corrigir `_shared/employee-sync.ts`, que ainda declara `Access-Control-Allow-Origin: *`.
- [ ] Revisar CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors` e `Referrer-Policy` do app publicado.
- [ ] Teste: chamadas a partir do domínio próprio (`erp-flow.cactuscorporation.com`), do domínio publicado e do preview.

### Sexta — Dia 5: fechamento

- [ ] Avaliar mover `pg_trgm` para o schema `extensions`, verificando os índices dependentes. Se houver risco de indisponibilidade da busca, registrar como risco aceito e não executar.
- [ ] Rodar novamente scanner de segurança, linter do banco e `npm audit`.
- [ ] Marcar como corrigidos os achados resolvidos.
- [ ] Publicar relatório final com o checklist e recomendação GO/NO-GO.

---

## 4. Detalhes técnicos

- Migrações pequenas e independentes, uma por tema (políticas, grants de função, extensão), para permitir rollback isolado.
- `ALTER POLICY ... TO authenticated` não altera a expressão da política; o efeito é apenas deixar de avaliá-la para requisições anônimas.
- Revogações usam assinatura completa, porque há funções sobrecarregadas (`check_applicable_approval_rules`, `find_open_registration_duplicate`):

```sql
REVOKE EXECUTE ON FUNCTION public.<fn>(<assinatura completa>) FROM anon;
```

- Funções chamadas por edge function com `service_role` não são afetadas pelas revogações de `anon`/`authenticated`.
- Nas edge functions, o CORS passa a devolver o cabeçalho apenas para origens da allowlist; a resposta a `OPTIONS` continua existindo em todas.
- Nada de alterar `verify_jwt`, chaves de API ou o schema de auth nesta semana.

---

## 5. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Revogar `EXECUTE` de função usada pelo frontend | Tela quebra | Inventário do Dia 3 + lotes com teste de fumaça entre eles |
| Restringir CORS em função consumida por origem não mapeada | Chamada bloqueada no browser | Allowlist já cobre domínio próprio, publicado, previews e `localhost`; variável `ALLOWED_ORIGINS` permite adicionar sem deploy |
| Mover `pg_trgm` exigir recriação de índices | Busca lenta ou indisponível temporariamente | Executar só com janela; caso contrário, registrar como risco aceito |
| Política restrita demais em tabela operacional | Usuário deixa de ver documento | Expressões preservadas na íntegra; apenas o papel muda |

---

## 6. Checklist de encerramento

- [ ] RLS habilitado e com política escopada em todas as tabelas; nenhum `USING (true)` sem escopo.
- [ ] Nenhuma chave `service_role` ou de terceiro no bundle do front.
- [ ] Segredos apenas em variáveis de ambiente das edge functions.
- [ ] Nenhuma função sensível executável por `anon`.
- [ ] CORS restrito em 100% das edge functions.
- [ ] Cabeçalhos de segurança configurados no app publicado.
- [ ] Scanner, linter e `npm audit` reexecutados e reportados.
- [ ] Memória de segurança atualizada apenas com riscos aceitos e justificados.
