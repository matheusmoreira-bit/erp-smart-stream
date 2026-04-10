

# Auditoria Completa do Sistema — Pontas Soltas, Segurança e Plano de Melhoria

---

## 1. Problemas Críticos de Segurança

### 1.1 Autenticação Admin via localStorage (CRÍTICO)
**Problema**: A senha de admin está hardcoded no frontend (`admin@2025` em `AdminLogin.tsx`) e a verificação é feita via `localStorage.getItem("admin_authenticated")`. Qualquer pessoa pode abrir o DevTools, executar `localStorage.setItem("admin_authenticated", "true")` e acessar `/admin`.

**Solução**: Migrar a autenticação admin para o backend usando Lovable Cloud Auth (email/senha). Criar uma tabela `user_roles` com role `admin` e validar no servidor.

### 1.2 Credenciais armazenadas em texto plano (ALTO)
**Problema**: `system_credentials.credential_value` armazena senhas, API keys e chaves AES em texto plano no banco. Qualquer query direta expõe tudo.

**Solução**: Usar `vault.secrets` do backend ou, no mínimo, encriptar os valores antes de salvar e decriptar apenas nas edge functions com a `SERVICE_ROLE_KEY`.

### 1.3 RLS totalmente permissiva (ALTO)
**Problema**: Todas as tabelas têm política `USING (true) WITH CHECK (true)` — qualquer usuário anônimo com a anon key pode ler/escrever tudo: credenciais, empresas, regras de aprovação, despesas.

**Solução**: Implementar autenticação real e RLS baseada em `auth.uid()`. Tabelas de admin (companies, system_credentials) devem ser acessíveis apenas por admins via `has_role()`.

### 1.4 Edge functions sem autenticação
**Problema**: `credentials`, `synapse-jc-sync`, `sap-b1-proxy` etc. aceitam qualquer request com a anon key. Não há validação de usuário autenticado.

**Solução**: Validar JWT nas edge functions e verificar roles quando necessário.

---

## 2. Inconsistências de Dados e Código

### 2.1 `COMPANY_LABELS` hardcoded em múltiplos lugares
**Problema**: `MainMenu.tsx` e `Synapse.tsx` mantêm dicionários hardcoded `{ SBO_ANAGAMING: "ANA Gaming", ... }`. A tabela `companies` já tem `display_name`, mas esses componentes não a consultam.

**Solução**: Criar um hook `useCompanies()` ou resolver o `display_name` da tabela `companies` em vez de manter constantes estáticas.

### 2.2 Definições de sistemas (`SYSTEMS`) duplicadas
**Problema**: `Admin.tsx` e `Credentials.tsx` duplicam a mesma estrutura `SYSTEMS` com campos idênticos.

**Solução**: Extrair para `src/lib/system-definitions.ts` e importar em ambos os componentes.

### 2.3 Tela de Credenciais vs Admin redundante
**Problema**: O usuário SAP pode configurar credenciais em `/credentials` e o admin em `/admin`. Ambos escrevem na mesma tabela, mas a UX é diferente e pode causar confusão sobre qual é a fonte de verdade.

**Solução**: Decidir se credenciais devem ser gerenciadas APENAS no admin, ou manter ambos mas com indicação clara de quem alterou por último.

---

## 3. Pontas Soltas Funcionais

### 3.1 Synapse não executa automaticamente
**Problema**: A integração JumpCloud → SAP só executa via botão manual. Não há cron/scheduler configurado para rodar a cada 6 horas conforme o `interval_minutes`.

**Solução**: Configurar um pg_cron ou um cron externo que invoque a edge function `synapse-jc-sync` periodicamente.

### 3.2 Sem audit log
**Problema**: Nenhuma ação administrativa (criar empresa, alterar credenciais, ativar/desativar integração) é registrada com quem fez e quando.

**Solução**: Criar tabela `audit_log` com `actor`, `action`, `entity`, `details`, `created_at`.

### 3.3 Sem proteção contra exclusão acidental
**Problema**: Empresas podem ser deletadas com um `confirm()` do browser. Isso remove a empresa mas NÃO limpa as credenciais órfãs na `system_credentials`.

**Solução**: Adicionar cascade delete ou soft delete, e exigir confirmação por digitação do nome da empresa.

### 3.4 `service_layer_url` da tabela `companies` não é utilizado pelo `sap-client.ts`
**Problema**: O campo foi adicionado à tabela mas o proxy SAP continua usando uma URL fixa. Cada empresa deveria usar sua própria URL de Service Layer.

**Solução**: Fazer o `sap-b1-proxy` buscar a `service_layer_url` da tabela `companies` com base no `companyDB` da sessão.

---

## 4. Plano de Implementação (por prioridade)

### Fase 1 — Segurança (imediato)
1. Implementar autenticação real com Lovable Cloud Auth (email/senha + Google)
2. Criar tabela `user_roles` com role enum (`admin`, `user`)
3. Proteger `/admin` com verificação de role via backend
4. Restringir RLS: tabelas admin → apenas admins; tabelas operacionais → usuários autenticados
5. Validar JWT nas edge functions

### Fase 2 — Consistência (curto prazo)
6. Extrair `SYSTEMS` para arquivo compartilhado
7. Substituir `COMPANY_LABELS` hardcoded por consulta à tabela `companies`
8. Fazer `sap-b1-proxy` usar `service_layer_url` da tabela `companies`
9. Cascade delete de credenciais ao excluir empresa

### Fase 3 — Operacional (médio prazo)
10. Configurar scheduler (pg_cron) para execução automática do Synapse
11. Criar tabela `audit_log` e registrar ações administrativas
12. Adicionar soft delete para empresas
13. Encriptar `credential_value` no banco

### Fase 4 — Expansão
14. Dashboard de saúde das integrações (uptime, falhas, latência)
15. Notificações por email quando integração falha
16. Suporte a novas integrações no Synapse (templates configuráveis)

---

## Detalhes Técnicos

```text
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Auth (Cloud) │────▶│  user_roles   │────▶│  RLS policies│
│  email/Google │     │  admin | user │     │  per table   │
└──────────────┘     └───────────────┘     └──────────────┘
                                                   │
                     ┌───────────────┐              │
                     │  audit_log    │◀─────────────┘
                     │  actor/action │
                     └───────────────┘

Edge Functions:
  JWT validation ──▶ has_role() check ──▶ execute logic
```

**Migration SQL (Fase 1)**:
- `CREATE TYPE app_role AS ENUM ('admin', 'user')`
- `CREATE TABLE user_roles (id uuid PK, user_id uuid REFERENCES auth.users ON DELETE CASCADE, role app_role, UNIQUE(user_id, role))`
- `CREATE FUNCTION has_role(uuid, app_role) RETURNS boolean SECURITY DEFINER`
- Reescrever todas as RLS policies usando `has_role()`

**Arquivos impactados** (Fase 1-2):
- `src/pages/AdminLogin.tsx` → reescrever com auth real
- `src/components/AdminRoute.tsx` → verificar role via Supabase
- `src/pages/Admin.tsx` → remover localStorage
- `src/pages/Credentials.tsx` → importar SYSTEMS compartilhado
- `src/components/MainMenu.tsx` → buscar display_name da DB
- `src/pages/Synapse.tsx` → idem
- `supabase/functions/sap-b1-proxy/index.ts` → usar service_layer_url
- Todas as edge functions → validar JWT

