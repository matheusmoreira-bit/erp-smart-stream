# Refatoração de UX/UI — Fusões, Renomes e Reagrupamento

Objetivo: reduzir de **19 cards / 6 grupos** para **~13 cards / 5 grupos**, usar linguagem de negócio e padronizar tudo no modelo "página única com abas".

---

## 1. Fusões (4 hubs com abas)

### 1.1 Aprovações (`/approvals`)
Funde `/approvals` + `/approvals/history` em uma só página com abas.
- Abas: **Pendentes** | **Histórico**
- Remove card "Histórico de Aprovações" do MainMenu
- Mantém rota `/approvals/history` como redirect para `/approvals?tab=history`
- Module keys `approvals` e `approval_history` continuam separados (controle de permissão por aba: se só tem `approval_history`, abre direto na aba histórico)

### 1.2 Auditoria (`/auditoria`) — nova rota
Funde Console de Auditoria + Auditoria Fiscal + Logs de Auditoria.
- Abas: **SAP** (atual `/analytics/audit/*`) | **Fiscal** | **Logs do Sistema**
- Redirects: `/analytics/audit` → `/auditoria?tab=sap`, `/fiscal-audit` → `/auditoria?tab=fiscal`, `/audit-log` → `/auditoria?tab=logs`
- Cada aba só renderiza se o usuário tiver a module key correspondente (`audit_console`, `fiscal_audit`, `audit_log`)

### 1.3 Integrações (`/integracoes`) — nova rota
Funde Synapse + Monitor de Integrações + Credenciais.
- Abas: **Automações** | **Monitor** | **Credenciais**
- Redirects de `/synapse`, `/integrations/monitor`, `/credentials`
- Visibilidade de aba por module key (`synapse`, `integration_history`, `credentials`)

### 1.4 Usuários (`/users`)
Consolida `/users` + `/users/activity` + `/users/productivity` + `/users/idp-sync` + `/users/license-analysis` + `/users/license-import` em abas.
- Abas: **Lista** | **Atividade** | **Produtividade** | **Licenças** (subaba Análise/Importação) | **Sincronização IdP**
- Mantém rotas antigas como redirects com `?tab=…`
- Visibilidade por module key

---

## 2. Renomeações

| Onde | De | Para |
|---|---|---|
| Card + página | PagCorp | **Cartões Corporativos** |
| Card + página | Synapse | **Automações** (dentro do hub Integrações) |
| Card + página | Intercompany | **Plano de Contas & CC** |
| Card + página | NF de Entrada (Master Tax) | **NF de Entrada** |
| Card + página | Avaliação Financeira | **Adiantamentos** |
| Card + página | Console de Auditoria | **Auditoria SAP** (aba) |
| Card + página | Logs de Auditoria | **Logs do Sistema** (aba) |
| Card + página | Monitor de Integrações | **Monitor** (aba) |

**Importante:** rotas físicas permanecem (`/pagcorp`, `/intercompany`, etc.) para não quebrar links salvos. Só muda o **label** exibido. Module keys permanecem inalteradas para não invalidar permissões existentes.

---

## 3. Reagrupamento do MainMenu

```text
Operação
  • Compras
  • Vendas
  • Aprovações                 (fusão)
  • Cartões Corporativos       (renomeado)

Cadastros
  • Fornecedores
  • Itens
  • Plano de Contas & CC       (renomeado)

Financeiro & Fiscal
  • Adiantamentos              (renomeado)
  • NF de Entrada              (renomeado)
  • Auditoria Fiscal → entra como aba de Auditoria (removido daqui)

Análise
  • Analytics
  • Auditoria                  (hub novo)

Administração
  • Usuários                   (hub consolidado)
  • Regras de Aprovação
  • Integrações                (hub novo)
  • Notificações
```

Resultado: 5 grupos, 13 cards visíveis no menu.

---

## 4. Detalhes técnicos

**Arquivos editados**
- `src/App.tsx` — novas rotas `/auditoria`, `/integracoes`; redirects das antigas
- `src/components/MainMenu.tsx` — novo mapa `modules`, novos grupos, labels renomeados, remoção dos cards fundidos
- `src/pages/Approvals.tsx` — adicionar abas Pendentes/Histórico (incorporando `ApprovalHistory.tsx` como subcomponente)
- `src/pages/Users.tsx` — converter em hub com abas, incorporando as 5 páginas existentes
- Nenhuma página antiga é deletada nesta etapa — viram subcomponentes/abas. Limpeza fica para uma segunda passada quando confirmarmos que nada quebrou.

**Arquivos novos**
- `src/pages/AuditHub.tsx` — abas SAP/Fiscal/Logs renderizando os componentes existentes
- `src/pages/IntegrationsHub.tsx` — abas Automações/Monitor/Credenciais

**Permissões (`src/hooks/usePermissions.ts`)**
- `ALL_MODULES`: atualizar apenas os `label`s renomeados (mantém `key` original)
- Comportamento de `useModuleAccess` permanece igual
- Hub abre na primeira aba a que o usuário tem acesso; se não tiver nenhuma, mostra estado "sem acesso"

**Compatibilidade**
- Todas as rotas antigas viram `<Navigate replace>` para o novo destino com `?tab=…`
- Atalhos `MainMenu` e quaisquer `navigate("/old-path")` no código continuam funcionando via redirect
- Memórias do projeto (visibility rule, OMIE open modules, users-screen-actions) continuam válidas — só mudam de local visual

---

## 5. Não incluído neste plano
- Alteração de module keys ou tabela de permissões (evita migration)
- Mudança visual além do necessário para abas (sem redesign)
- Tradução/i18n
- Remoção definitiva dos arquivos `ApprovalHistory.tsx`, `Synapse.tsx`, `Credentials.tsx`, `IntegrationsMonitor.tsx`, `FiscalAudit.tsx`, `AuditLog.tsx`, `AuditConsole.tsx`, `UserActivity.tsx`, `UserProductivity.tsx`, `IdpSync.tsx`, `LicenseAnalysis.tsx`, `LicenseImport.tsx` — segunda passada após validação

---

## 6. Ordem de execução sugerida
1. Renomes (label-only) — mudança visual imediata, risco zero
2. Reagrupamento do MainMenu
3. Fusão Aprovações (mais simples, 2 abas)
4. Hub Usuários
5. Hub Auditoria
6. Hub Integrações
