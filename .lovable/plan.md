

## Plano de Melhorias — Segurança, Velocidade e Escalabilidade

---

### 1. SEGURANÇA

#### 1.1 Edge Functions sem autenticação (CRÍTICO)
As edge functions `credentials`, `sap-b1-proxy`, `pagcorp-proxy`, `omie-proxy` usam apenas o `anon key` — qualquer pessoa com a chave pública pode chamar esses endpoints. Credenciais sensíveis (senhas SAP, chaves de API) ficam expostas.

**Ação:** Adicionar validação de JWT via `getClaims()` em todas as edge functions. Apenas usuários autenticados com role `admin` devem acessar endpoints de credenciais.

#### 1.2 Políticas RLS excessivamente permissivas para `anon` (CRÍTICO)
Várias tabelas permitem `INSERT`, `UPDATE` e `DELETE` para o role `anon`:
- `pagcorp_account_mapping`, `pagcorp_item_mapping`
- `permission_groups`, `permission_group_modules`, `user_group_assignments`
- `synapse_integrations`

**Ação:** Remover políticas `anon` de escrita e restringir a `authenticated` com `has_role('admin')`, mantendo apenas leitura para `anon` onde necessário (ex.: `sap_cache`).

#### 1.3 Validação de input nas Edge Functions
As functions `credentials` e `sap-b1-proxy` não validam o corpo da requisição com schema. Parâmetros como `endpoint` no proxy SAP podem ser manipulados.

**Ação:** Adicionar validação com Zod em todas as edge functions — tipos, tamanhos máximos e caracteres permitidos.

#### 1.4 URL hardcoded do SAP e N8N no código
O `sap-b1-proxy` contém URLs de produção hardcoded (`DEFAULT_SAP_BASE_URL`, `HANA_VIEWS_URL`).

**Ação:** Mover para secrets do projeto, referenciáveis via `Deno.env.get()`.

---

### 2. VELOCIDADE

#### 2.1 Admin.tsx monolítico (988 linhas)
O arquivo `Admin.tsx` concentra wizard, listagem, tabs de credenciais, permissões, audit log e integrações em um único componente.

**Ação:** Extrair em componentes dedicados:
- `CompanyWizardDialog`
- `CompanyList`  
- `AdminTabs` (container das tabs)

Isso reduz re-renders desnecessários e melhora o code-splitting.

#### 2.2 Cache SAP duplicado (client + edge function)
Existe cache em memória tanto no client (`sap-client.ts`, 3 min) quanto na edge function (`sap-b1-proxy`, 5 min), além do `sap_cache` no banco. Três camadas sem invalidação coordenada.

**Ação:** Unificar estratégia: usar `sap_cache` (banco) como source of truth com TTL, `stale-while-revalidate` no client via React Query, e remover cache in-memory da edge function.

#### 2.3 Migrar para React Query / TanStack Query
Hooks como `useAuditLog`, `useCompanies`, `useExpenses` fazem fetch manual com `useState`/`useEffect`. Não há deduplicação, refetch automático ou cache compartilhado.

**Ação:** Adotar React Query para todos os hooks de dados — ganho imediato em cache, deduplicação, background refetch e loading states.

#### 2.4 Índices no banco de dados
Tabelas frequentemente filtradas (`audit_log` por `company_db`/`created_at`, `system_credentials` por `company_db`/`system_name`) não possuem índices explícitos.

**Ação:** Criar índices compostos nas colunas mais filtradas.

---

### 3. ESCALABILIDADE

#### 3.1 Paginação server-side no Audit Log
O audit log faz `SELECT * ... LIMIT 1000` sem paginação. Com crescimento, isso se torna lento e consome memória.

**Ação:** Implementar paginação com cursor (`created_at` + `id`) e infinite scroll ou paginação numérica no frontend.

#### 3.2 Tabela `sap_cache` sem limpeza automática
Entradas expiradas no `sap_cache` ficam no banco indefinidamente.

**Ação:** Criar um cron job (pg_cron ou edge function scheduled) para limpar registros onde `expires_at < now()`.

#### 3.3 Preparar multi-tenant consistente
O campo `company_db` é usado como tenant key, mas não está presente em todas as tabelas relevantes (ex.: `expenses`, `expense_items` não têm `company_db`).

**Ação:** Adicionar `company_db` às tabelas operacionais e criar RLS policies scoped por empresa, preparando para isolamento real de dados entre empresas.

#### 3.4 Storage de logo via bucket dedicado
Atualmente o logo da empresa é salvo como URL externa. Isso depende de serviços terceiros e não tem controle de acesso.

**Ação:** Criar bucket `company-logos` no storage e implementar upload direto com preview no wizard.

---

### Prioridade sugerida

| Prioridade | Item | Impacto |
|-----------|------|---------|
| P0 | 1.1 Auth nas Edge Functions | Dados sensíveis expostos |
| P0 | 1.2 RLS anon excessivo | Qualquer visitante pode alterar permissões |
| P1 | 1.3 Validação de input | Prevenção de injection |
| P1 | 2.3 React Query | Performance geral + DX |
| P1 | 3.3 Multi-tenant consistente | Isolamento de dados |
| P2 | 2.1 Refatorar Admin.tsx | Manutenibilidade |
| P2 | 2.4 Índices no banco | Performance em escala |
| P2 | 3.1 Paginação audit log | Escalabilidade |
| P3 | 1.4 URLs em secrets | Higiene de config |
| P3 | 2.2 Unificar cache SAP | Consistência |
| P3 | 3.2 Limpeza sap_cache | Manutenção |
| P3 | 3.4 Bucket de logos | Robustez |

