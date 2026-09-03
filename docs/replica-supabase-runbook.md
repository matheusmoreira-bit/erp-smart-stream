# Ambiente de réplica (Supabase) — Runbook de preparação e cutover

Ambiente destino preparado para uma futura migração. **Hoje é schema-only**: estrutura completa, sem dados e sem sincronização contínua.

## 1. Estado atual (03/09/2026)

Paridade estrutural validada entre origem e destino:

| Objeto | Origem | Destino |
| --- | --- | --- |
| Tabelas (`public`) | 169 | 169 |
| Views | 1 | 1 |
| Funções | 132 | 133* |
| Policies RLS | 345 | 345 |
| Índices | 507 | 507 |
| Tabelas sem RLS | 0 | 0 |

\* diferença de 1 é overload adicional já existente, sem impacto.

Incluídos: extensões, enums, sequences, tabelas, constraints, índices, triggers, funções, views, RLS, policies e grants (`authenticated` / `service_role`; `anon` apenas onde há policy pública).

**Não replicado ainda:** dados, Edge Functions, buckets/objetos de Storage, secrets, configuração de Auth (provedores, templates, SMTP) e cron/queues.

## 2. Limitações conhecidas

- Não é possível configurar replicação lógica contínua a partir deste ambiente: o papel usado na origem não possui `REPLICATION`/superuser. `wal_level` já é `logical`, então o cutover por `pg_dump`/restore ou por publication/subscription criada com credenciais administrativas é viável quando houver acesso.
- A senha do banco de destino foi compartilhada em chat e deve ser considerada comprometida. **Rotacionar antes do cutover** e nunca versionar.

## 3. Manutenção da paridade (enquanto não migra)

Toda migração aplicada na origem deve ser reaplicada no destino, na mesma ordem:

1. Aplicar a migration no ambiente atual.
2. Rodar o mesmo SQL no destino (`psql "postgresql://postgres@db.<ref>.supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f arquivo.sql`).
3. Conferir paridade com a query da seção 6.

## 4. Cutover (quando decidido)

1. **Congelar escritas**: ativar modo somente leitura no ERP Flow (`useReadOnlyMode`) e pausar integrações (`integration_pause`), cron e watchers.
2. **Rotacionar segredos** do destino (senha do banco, chaves de API).
3. **Dados**: `pg_dump --data-only --disable-triggers --schema=public` da origem e restore no destino. Restaurar também `auth.users` e `storage.objects` via dump administrativo do projeto.
4. **Sequences**: `SELECT setval(...)` para todas as sequences após a carga.
5. **Storage**: copiar buckets e objetos; recriar políticas de bucket.
6. **Edge Functions**: fazer deploy de todas as funções em `supabase/functions/` no novo ref e recriar os secrets (SAP, HanaAPI, PagCorp, e-mail, API keys externas).
7. **Auth**: reconfigurar provedores (Google), templates de e-mail, domínio de e-mail e URLs de redirect.
8. **Frontend**: trocar `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SUPABASE_PROJECT_ID` (ponto único em `src/config/runtime.ts`).
9. **Validação** (seção 5) e só então liberar escrita.
10. **Rollback**: manter a origem intacta e somente leitura por 72h; reverter é voltar as variáveis do frontend.

## 5. Checklist de validação pós-cutover

- Login Google e troca de empresa sem pedir senha do SAP.
- Criar, aprovar e integrar um pedido de compra ao SAP (com anexo).
- Emitir NFSe de um pedido de venda e registrar baixa.
- Aprovações pendentes, histórico de aprovações e revisões de pedido.
- Notificações por e-mail e fila de reprocessamento (`sap_retry_queue`).
- Auditoria: `verify_audit_chain` sem quebras; `audit_trail_all` consultável por admin.
- Linter de segurança sem novos achados de RLS.

## 6. Query de paridade

```sql
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tabelas,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')) as views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as funcoes,
  (select count(*) from pg_policies where schemaname='public') as policies,
  (select count(*) from pg_indexes where schemaname='public') as indices,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) as sem_rls;
```
