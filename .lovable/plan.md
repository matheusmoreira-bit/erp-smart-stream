## Objetivo

Eliminar os 10 findings críticos do scan de segurança e reduzir os warnings antes da publicação. O foco é remover acesso do role `anon` (usuário não autenticado) a dados financeiros e a configurações que controlam aprovações.

## Escopo — Fase 1 (bloqueadores de publicação)

### 1. Remover leitura anônima de dados financeiros
Drop das policies `anon SELECT` nas tabelas:
- `expenses`, `expense_items`, `expense_attachments`, `expense_approval_log`
- `audit_log` (policy "Anyone can view expense audit_log" — remover `anon` do array de roles, manter para `authenticated`)
- `pagcorp_integration_log`
- `nf_entrada_logs`, `nf_entrada_imports`

Verificar que já existem policies para `authenticated` cobrindo o uso legítimo. Onde faltar, criar policy `authenticated` escopada (dono/aprovador/admin).

### 2. Remover escrita anônima (privilege escalation)
Drop de TODAS as policies `anon` (SELECT/INSERT/UPDATE/DELETE) em:
- `approval_rules` e `approval_rule_levels` — só admin gerencia
- `sap_cache` — só service_role/edge functions
- `pagcorp_settlement_accounts` — só admin

Substituir por policies `authenticated` restritas ao `admin` via `has_role(auth.uid(),'admin')`.

### 3. Warnings de exposição
Remover `anon` SELECT de:
- `pagcorp_nondeductible_cards`
- `synapse_execution_log`, `synapse_integrations`, `synapse_global_settings`

Manter `companies` (is_active=true) público, pois é usado na tela de login para listar bases.

### 4. Storage bucket `expense-attachments`
Adicionar policies em `storage.objects` restringindo o bucket a `authenticated`, escopadas ao dono do expense (via subquery em `expense_attachments`).

## Escopo — Fase 2 (hardening — pode ir junto na mesma migration)

### 5. `search_path` em funções SECURITY DEFINER
Adicionar `SET search_path = public` nas funções que ainda estão sem (o scan aponta ~5 funções — identificar via linter e corrigir uma a uma).

### 6. Policies `USING (true)` em UPDATE/DELETE/INSERT
Revisar as ~30 policies apontadas pelo scan e trocar `true` por checagem real (`auth.uid()=user_id`, `has_role(...,'admin')`, etc.). Como são muitas tabelas, faço um levantamento tabela-a-tabela e proponho o replace de cada uma dentro da mesma migration.

### 7. SECURITY DEFINER executável por `authenticated`
Revogar `EXECUTE ... FROM authenticated` das funções que só devem ser chamadas por edge functions/service_role (ex.: `email_queue_dispatch`, `email_queue_wake`, `move_to_dlq`, `enqueue_email`, `delete_email`, `read_email_batch`, `prune_old_integration_data`, `archive_audit_trail`). Manter execução para funções usadas pelo app (`has_role`, `create_item_variante`, `check_applicable_approval_rules`, etc.).

## Escopo — Fase 3 (config, fora de migration)

- Ativar **Password HIBP Check** no Cloud → Users → Auth Settings.
- Confirmar verificação de e-mail obrigatória.

## Fora deste plano

- Cabeçalhos CSP/HSTS/frame-ancestors: dependem do host (Lovable serve os cabeçalhos padrão). Documento como recomendação para o time de infra, não altero no código.
- SSO Okta: já estava na lista de recomendações, mas é projeto separado.
- Code scanning GitHub: responsabilidade do repositório.

## Riscos e mitigação

- **Quebra de funcionalidade**: se algum código do app ou edge function estiver dependendo do role `anon` para ler/escrever nessas tabelas, ele passa a falhar. Antes de aplicar, faço grep no código por chamadas anônimas (sem `supabase.auth.getSession()`) contra essas tabelas. As edge functions usam `service_role`, então não são afetadas.
- **Regras de aprovação**: hoje `approval_rules`/`approval_rule_levels` estão editáveis por qualquer um sem login — impacto crítico. A troca para "só admin" pode quebrar telas que hoje editam anonimamente; identificar essas telas e garantir que o usuário está logado como admin (o app já tem `has_role`).

## Ordem de execução

1. Grep no `src/` e nas edge functions procurando queries às tabelas afetadas para confirmar que usam sessão autenticada.
2. Uma migration única com Fase 1 + Fase 2.
3. Rodar `security--run_security_scan` de novo e confirmar que os 10 críticos sumiram.
4. Ligar HIBP via `supabase--configure_auth`.

## Detalhes técnicos

Padrão de policy para dados financeiros:
```sql
DROP POLICY "Anon can read expenses" ON public.expenses;
-- (mantém as policies existentes de authenticated que já filtram por dono/aprovador/admin)
```

Padrão para approval_rules:
```sql
DROP POLICY "Anon can read approval_rules" ON public.approval_rules;
DROP POLICY "Anon can insert approval_rules" ON public.approval_rules;
DROP POLICY "Anon can update approval_rules" ON public.approval_rules;
DROP POLICY "Anon can delete approval_rules" ON public.approval_rules;
-- garantir policies authenticated para admin (has_role) já existem
```

Padrão para storage:
```sql
CREATE POLICY "auth can read own expense files" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'expense-attachments'
  AND EXISTS (
    SELECT 1 FROM public.expense_attachments a
    JOIN public.expenses e ON e.id = a.expense_id
    WHERE a.file_path = storage.objects.name
      AND (e.requester_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  )
);
```
