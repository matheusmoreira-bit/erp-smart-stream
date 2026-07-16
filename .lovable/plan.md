
# Integração de Colaboradores JumpCloud → SAP B1

Nova funcionalidade em **Integrações → Colaboradores** que sincroniza usuários do JumpCloud com `EmployeesInfo` do SAP Service Layer, **somente em bases cujo `CompanyDB` comece com `TST`**. Upsert por `U_JC_UserId`, sem deletes, com simulação, agendamento e logs.

## Restrição de ambiente (bloqueio duplo)
- **Backend**: toda edge function valida `CompanyDB LIKE 'TST%'` (case-insensitive) antes de qualquer chamada ao SAP. Caso contrário retorna 403 com a mensagem exigida.
- **Frontend**: seletor de base SAP filtra `companies` por `company_db ILIKE 'TST%'`; botão "Sincronizar agora" desabilitado se não bater.

## Modelo de dados (migração única)
Novas tabelas em `public` (todas com RLS + GRANT authenticated/service_role, timestamps + trigger `update_updated_at_column`):

- `employee_integration_config` — 1 por base SAP: `name`, `company_db`, `jumpcloud_org_id`, `jumpcloud_api_key_encrypted` (via `pgsodium`/vault ou reuso de `system_credentials`), `schedule_type`, `is_active`, `sync_inactive_users`, `sync_managers`, `default_department_code`, `default_branch_code`, `last_execution_at`.
- `employee_sync_execution` — cabeçalho: tipo (`manual|scheduled|simulate`), status, contadores (`total_source/created/updated/unchanged/inactivated/pending/errors`), `triggered_by`, `started_at`, `finished_at`, `error_message`.
- `employee_sync_item` — 1 linha por colaborador processado: `jumpcloud_user_id`, `sap_employee_id`, `employee_name/email`, `result` (`created|updated|unchanged|inactivated|pending|error|would_*`), `message`, `changed_fields jsonb`, `source_payload jsonb`, `normalized_payload jsonb`, `sap_payload jsonb`, `hash`.
- `employee_department_mapping` — `(config_id, jumpcloud_department)` → `sap_department_code`, `sap_department_name`.
- `employee_pending_relation` — gestores pendentes: `(config_id, employee_jc_id, manager_jc_id, resolved_at)`.

RLS: leitura/gestão apenas para `admin` ou usuários com módulo `employee_integration.*` (via `permission_group_modules`). Service role tem `ALL`.

Reaproveita `system_credentials` para chaves do JumpCloud por empresa (padrão já usado por `synapse-jc-sync`), evitando duplicar armazenamento de segredo. Chave nunca retornada ao front — apenas máscara.

## Edge Functions (novas)

1. `employees-sync-test-jumpcloud` — valida API key + org, retorna contagem.
2. `employees-sync-test-sap` — faz `Login` + `GET $metadata` + `GET EmployeesInfo?$top=1`, retorna se `U_JC_UserId`, `U_JC_Active`, `U_JC_Status`, `U_JC_LastHash` etc. existem como UDFs. Se faltar UDF, retorna lista de campos ausentes; execução real bloqueada.
3. `employees-sync-run` — execução principal. Fluxo:
   1. Valida `CompanyDB ILIKE 'TST%'`.
   2. Adquire lock via `watcher_runs` (`try_watcher_lock('employees-sync:'||company_db)`).
   3. Cria `employee_sync_execution` com status `running`.
   4. Login SAP (reuso `system_credentials` sap) + JumpCloud API key.
   5. Busca `$metadata` e valida UDFs necessários.
   6. Pagina JumpCloud (`/api/systemusers`, `limit=100&skip=N`) até esgotar.
   7. Normaliza (trim, lowercase email, telefones, hash SHA-256 dos campos relevantes).
   8. Pagina SAP (`EmployeesInfo?$select=EmployeeID,FirstName,LastName,EMail,U_JC_UserId,U_JC_LastHash`) + segue `odata.nextLink`.
   9. Indexa por `U_JC_UserId`; fallback secundário por e-mail para vincular registros antigos.
   10. Aplica mapeamento de departamento; se faltar e não houver default → `pending`.
   11. Para cada colaborador:
       - Não existe → `POST EmployeesInfo` (ou `would_create` se `mode=simulate`).
       - Existe + hash igual → `unchanged`.
       - Existe + hash diferente → `PATCH EmployeesInfo({id})` (ou `would_update`).
       - Suspenso no JC → PATCH `U_JC_Active='N'`, `U_JC_Status='SUSPENDED'` (nunca DELETE).
       - Erro de sessão SL (401) → relogin + 1 retry; 429/5xx → backoff (reuso `sap-fetch.ts`).
   12. Segunda passada: resolve `manager` via `U_JC_UserId → EmployeeID`; grava pendências não resolvidas.
   13. Finaliza execução, atualiza `last_execution_at`, libera lock.
4. `employees-sync-cron` — invocada por `pg_cron`; itera configs ativas cujo `schedule_type` bata com o horário e dispara `employees-sync-run` (skip se lock ativo).

Todas as functions usam `_shared/integration-log.ts` (`system_name='jumpcloud_employees'`), CORS padrão, `verify_jwt` default (chamadas do app com JWT autenticado; cron com service role Bearer). Nenhuma credencial em log.

## Cron
Migração adiciona `cron.schedule('employees-sync-tick', '*/15 * * * *', ...)` chamando `employees-sync-cron` via `net.http_post` com service role do vault (mesmo padrão de `email_queue_dispatch`).

## Frontend

Nova rota `/integracoes/colaboradores` dentro de `IntegrationsHub` (adiciona 4ª aba após "Credenciais"), gated por módulo `employee_integration` e por base `TST%`.

Páginas/componentes novos em `src/pages/EmployeesIntegration/`:
- `index.tsx` — KPIs (contadores da última execução), lista de configs por base, botão "Nova integração".
- `ConfigForm.tsx` — form: nome, base SAP (dropdown filtrado `TST%`), org JumpCloud, API key (input mascarado; POST somente para gravar), periodicidade, flags, dept/branch default. Botões "Testar JumpCloud" / "Testar SAP" chamam edge functions e mostram campos UDF ausentes se houver.
- `DepartmentMappingTab.tsx` — grid Jumpcloud dept → SAP dept (dropdown alimentado por `Departments` do SAP).
- `RunDialog.tsx` — confirma base (destacando "base de teste"), radio Executar/Simular.
- `ExecutionList.tsx` — histórico com filtros (status, tipo, período).
- `ExecutionDetail.tsx` — resumo, tabela de `employee_sync_item` filtrável (novo/atualizado/sem alteração/inativado/pendente/erro), export CSV, sem payloads sensíveis.

Hook `useEmployeeIntegration.ts` (react-query) para configs, execuções, itens e mapeamentos.

Menu: adicionar item "Colaboradores" em `MainMenu`/`MobileMenuSheet` sob "Integrações", visível apenas com módulo `employee_integration.view`.

## Permissões
Novos `module_key`s em `permission_group_modules`:
- `employee_integration.view`
- `employee_integration.manage`
- `employee_integration.execute`
- `employee_integration.view_logs`

Admin sempre acessa. `usePermissions` mapeia para gate de UI; RLS confere no back.

## Segurança
- API key JumpCloud gravada apenas via edge function usando service role (front nunca lê valor). Exibição sempre mascarada.
- Nenhum log ou payload armazena `apikey`, `B1SESSION`, `Password`.
- CSRF/CORS: functions restringem `Access-Control-Allow-Origin` ao domínio publicado + preview.
- Validação Zod dos bodies das functions.
- RLS escopada por posse/role — sem `USING (true)`.
- Lock impede execução paralela por `(company_db)`.

## Fora de escopo (declarado)
- Nenhuma alteração em módulos existentes (`synapse-jc-sync` continua tratando bloqueio de usuários SAP; não é substituído).
- Sem criação automática de UDFs, departamentos, filiais, usuários SAP, vendedores.
- Sem DELETE em `EmployeesInfo`.
- Bases não-TST bloqueadas nesta entrega; futura configuração de allowlist já contemplada no schema (`is_active` + validação central em uma função `assert_company_allowed_for_employee_sync` fácil de estender).

## Detalhes técnicos

### Hash de idempotência
```
sha256(join('|', [FirstName, MiddleName, LastName, JobTitle, EMail,
  WorkPhone, MobilePhone, DepartmentCode, ManagerJcId, Status]))
```
Guardado em `U_JC_LastHash` no SAP e em `employee_sync_item.hash`. PATCH só quando difere.

### Fluxo resumido
```text
[JC users] --paginate--> normalize --hash--\
                                            +--> compare --> POST/PATCH/skip --> log item
[SAP EmployeesInfo] --paginate--> index ---/
                                            \--> manager pass --> resolve or pending
```

### Reuso
- `_shared/sap-fetch.ts` (timeout, retry, backoff).
- Padrão de credenciais `system_credentials` (chaves `jumpcloud` e `sap`) já usado em `synapse-jc-sync`.
- `integration_log` para observabilidade cross-integrações.
- `watcher_runs` para locks (função `try_watcher_lock` já existe).

### Ordem de entrega
1. Migração (tabelas, RLS, GRANTs, módulos de permissão, cron).
2. Edge functions test-jc, test-sap, run, cron.
3. Hooks + páginas React + rota + item de menu.
4. Testes manuais em `TST - ANAGAMING` cobrindo os 8 cenários do brief.
