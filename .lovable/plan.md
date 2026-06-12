# Plano — Evoluções Backoffice, Compras e PagCorp

Trabalho dividido em 4 fases agrupadas por afinidade técnica. Cada fase é entregável de forma independente.

## Fase 1 — Segregação por base + UX transversal

**2. Segregação de integrações por base (crítico)**
- Auditar `pagcorp_integration_log`, `nf_entrada_imports`, `nf_entrada_logs`, `synapse_execution_log`, `audit_console_*` e tabelas relacionadas para garantir que toda linha grava `company_db`.
- Backfill onde necessário; adicionar `NOT NULL` + índice em `company_db`.
- Filtrar todas as queries do front (`IntegrationHistory`, `IntegrationsMonitor`, `PagCorp`, `Approvals`, `Expenses`) pelo `companyDB` ativo do `SapContext`.
- Edge functions (`pagcorp-to-sap`, `expense-to-sap`, `nf-entrada-to-sap`) devem persistir `company_db` recebido no payload, sem fallback global.

**6. Fechamento de modal ao clicar fora**
- Revisar wrappers `Dialog` / `Sheet` que sobrescrevem `onPointerDownOutside`/`onInteractOutside` com `preventDefault()`.
- Remover esses bloqueios exceto em diálogos críticos explicitamente marcados (deletes, confirmações destrutivas).

**8. Anexos abrindo em nova aba**
- Nos modais `PagCorpIntegrateDialog`, `PagCorpConsolidateDialog`, `EditExpenseModal`, trocar previews inline por `<a target="_blank" rel="noopener noreferrer">` mantendo o modal aberto.

## Fase 2 — Compras: aprovação inline + visibilidade de integração

**3. Aprovação direta na tela de Compras**
- Em `Expenses.tsx` (drawer/modal de detalhe), consultar `approval_rule_levels` + `approver_cost_centers` para verificar se `sapUsername` atual está na lista de aprovadores do nível pendente.
- Exibir botões `Aprovar` / `Rejeitar` reutilizando a mutação do hook `useApprovals`. Atualizar status local + `approval_history`.
- Esconder botões para não-aprovadores.

**4. Bloco de integração no documento**
- No detalhe da despesa, buscar último registro em `pagcorp_integration_log` / `nf_entrada_logs` correspondente ao documento.
- Mostrar: número do documento ERP (PO/PC/NF), status, data, e botão "Ver detalhes" abrindo modal estilo Monitor de Integrações.

## Fase 3 — PagCorp: anexos completos + busca de fornecedores

**5. Todos os anexos no PagCorp**
- Em `PagCorpIntegrateDialog` e `PagCorpPresentationDialog`, usar `collectReceiptUrls` (já criado na fase anterior) para listar 100% dos anexos.
- Renderizar galeria/carrossel com contador "X anexos" e navegação prev/next.

**7. Busca de fornecedores melhorada**
- Em `SupplierFormModal`, `PagCorpIntegrateDialog` e `CachedSearchCombobox` usado para fornecedor, exibir resultado em colunas: Código | Razão Social | Nome Fantasia | CNPJ.
- Permitir busca por qualquer um dos 4 campos (já indexados em `suppliers`).

## Fase 4 — Backoffice: Gestão de Usuários SAP

**1. Tela de gestão SAP centralizada**
- Nova rota `/admin/sap-users` (admin-only via `AdminRoute`).
- UI: tabela com filtro por empresa (combo de `companies` SAP ativas), colunas: empresa, UserCode, Nome, E-mail, Grupo, Status (ativo/bloqueado), último login.
- Edge function nova `sap-users-admin` que, dado `company_db` + ação, usa as credenciais admin de `system_credentials` (via `sap-multi-password` pattern já existente) para:
  - `GET Users` (listagem)
  - `PATCH Users(InternalKey)` para: bloquear (`Locked=tYES`), desbloquear, alterar nome, alterar grupo (`UserPermission`), parâmetros.
  - Reuso de `changePasswordInCompanies` para reset.
- Todas as ações registradas em `audit_log` via `insert_audit_log`.

## Detalhes técnicos

- **Tabelas novas/alteradas**: nenhuma nova; apenas `NOT NULL` + índices em `company_db` nas tabelas de log/integração identificadas na Fase 1.
- **Edge functions novas**: `sap-users-admin`.
- **Edge functions alteradas**: `pagcorp-to-sap`, `expense-to-sap`, `nf-entrada-to-sap` (forçar `company_db`).
- **Hooks novos**: `useSapUsersAdmin` (CRUD SAP cross-company).
- **Componentes novos**: `SapUsersAdminPage`, `SapUserEditDialog`, `IntegrationStatusBlock` (reutilizável em Compras), `AttachmentGallery` (PagCorp).
- **Memória de projeto**: registrar regra "toda integração persiste e filtra por `company_db` do contexto ativo".

## Ordem de execução

Sugiro começar pela **Fase 1** porque a segregação por base é bug crítico e o ajuste de modais é base para as fases seguintes. Confirma a ordem ou prefere outra priorização?
