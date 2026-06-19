# Padronização de Nomenclatura, Títulos e URLs

Reescrita completa de marca, rótulos do menu, `<h1>`, `<title>` por rota e URLs para o esquema unificado em PT-BR. **Sem redirects legados** — URLs antigas deixam de existir.

> ⚠️ Quem tiver bookmarks ou clicar em links antigos de e-mails de aprovação cairá em 404. Confirme antes que isso é aceitável.

---

## 1. Marca (fixes rápidos)

| Arquivo | De | Para |
|---|---|---|
| `index.html` | `<title>ERP FLow</title>`, `lang="en"`, meta description em inglês | `<title>ERP Flow — Gestão Corporativa</title>`, `lang="pt-BR"`, descrição em PT-BR |
| `index.html` | `og:title`, `twitter:title` = "ERP FLow" | "ERP Flow" |
| `package.json` | `"vite_react_shadcn_ts"` | `"erp-flow"` |
| `MainMenu.tsx` | `<h1>ERP Analytics</h1>` | `<h1>ERP Flow</h1>` |

## 2. Esquema novo de URLs

```text
/                            Painel
/compras                     (era /expenses)
/vendas                      (era /sales)

/aprovacoes                  Hub → redirect para /aprovacoes/pendentes
/aprovacoes/pendentes        (era /approvals)
/aprovacoes/historico        (era /approvals?tab=history)
/aprovacoes/regras           (era /approval-rules)

/cartoes                     Hub Cartões Corporativos
/cartoes/transacoes          (era /pagcorp)
/cartoes/mapeamento          (era /pagcorp/mapping)
/cartoes/indedutiveis        (era /pagcorp/nondeductible)
/cartoes/historico           (era /pagcorp/history)

/auditoria, /auditoria/sap, /auditoria/fiscal, /auditoria/logs    (mantém ✅)
/integracoes/automacoes, /integracoes/monitor, /integracoes/credenciais  (mantém ✅)

/usuarios                    Hub (era /users)
/usuarios/lista              (era /users)
/usuarios/atividade          (era /users/activity)
/usuarios/produtividade      (era /users/productivity)
/usuarios/licencas           (era /users/license-analysis)
/usuarios/importar-licencas  (era /users/license-import)
/usuarios/sincronizacao-idp  (era /users/idp-sync)

/cadastros/fornecedores      (era /suppliers)
/cadastros/fornecedores/importar-cartoes  (era /suppliers/import-pagcorp)
/cadastros/itens             (era /items)
/cadastros/intercompany      (era /intercompany)

/financeiro/adiantamentos    (era /advance-payments)
/financeiro/reconciliacao    (era /financial-review)
/financeiro/nf-entrada       (era /nf-entrada)

/analytics, /notificacoes    (notifications → notificacoes)
/backoffice/*                (mantém)
```

Todos os redirects legados em `App.tsx` removidos (`/synapse`, `/audit-log`, `/fiscal-audit`, `/credentials`, `/cadastros/*` em formato antigo, `/analytics/audit`).

## 3. Rótulos do menu e h1 (padronização)

| Módulo | Menu label | H1 | Title (`<title>`) |
|---|---|---|---|
| Painel | — | "ERP Flow" | "ERP Flow" |
| Compras | "Compras" | "Compras" | "Compras — ERP Flow" |
| Vendas | "Vendas" | "Vendas" | "Vendas — ERP Flow" |
| Aprovações (pendentes) | "Aprovações" | "Aprovações Pendentes" | "Aprovações — ERP Flow" |
| Aprovações (histórico) | — (tab) | "Histórico de Aprovações" | "Histórico de Aprovações — ERP Flow" |
| Regras | "Regras de Aprovação" | "Regras de Aprovação" | idem |
| Cartões / Transações | "Cartões Corporativos" | "Cartões Corporativos — Transações" | idem |
| Cartões / Mapeamento | (tab) | "Mapeamento de Cartões → SAP" | idem |
| Cartões / Indedutíveis | (tab) | "Cartões Indedutíveis" | idem |
| Cartões / Histórico | (tab) | "Histórico de Integrações de Cartões" | idem |
| Auditoria SAP | "Auditoria" | "Auditoria SAP" | idem |
| Logs | (tab "Logs do Sistema") | "Logs do Sistema" | idem |
| Automações | (tab "Automações") | "Automações" (não mais "Synapse") | idem |
| Monitor | (tab "Monitor de Integrações") | "Monitor de Integrações" | idem |
| Usuários | "Usuários" | "Gestão de Usuários" | idem |
| IdP Sync | (tab "Sincronização IdP") | "Sincronização IdP" | idem |
| Adiantamentos | "Adiantamentos" | "Adiantamentos a Fornecedor" | idem |
| Reconciliação | "Reconciliação de Adiantamentos" | "Reconciliação de Adiantamentos" | idem |
| NF Entrada | "NF de Entrada" | "Integração NF de Entrada" | idem |
| Intercompany | "Plano de Contas & CC" | "Plano de Contas & Centros de Custo" | idem |

H1 errados `"SAP B1 Analytics"` corrigidos em `Expenses`, `Sales`, `ApprovalRules`, `Approvals`.

## 4. `<title>` por rota

- Instalar `react-helmet-async`.
- Adicionar `<HelmetProvider>` em `src/main.tsx`.
- Adicionar `<Helmet><title>...</title></Helmet>` em cada página listada acima.

## 5. PagCorp → Cartões Corporativos (cuidados)

- A marca "PagCorp" some das URLs, rótulos e h1.
- **Permanece nos dados internos** (nomes de tabelas/colunas no banco, nomes de edge functions, campos de mapeamento `pagcorp_*`). Renomear schema seria invasivo e fora do escopo desta rodada.
- Componentes/arquivos com `PagCorp` no nome (`PagCorpMapping.tsx`, `useCreatePagCorp...`) ficam como estão; só UI textual muda.

## Arquivos a editar (estimativa)

- `index.html`, `package.json`, `src/main.tsx`, `src/App.tsx`, `src/components/MainMenu.tsx`, `src/components/HubTabs.tsx`
- Páginas com mudança de h1/title: `Expenses`, `Sales`, `Approvals`, `ApprovalHistory`, `ApprovalRules`, `PagCorp`, `PagCorpMapping`, `PagCorpNondeductible`, `IntegrationHistory`, `AuditConsole`, `FiscalAudit`, `AuditLog`, `Synapse`, `IntegrationsMonitor`, `Credentials`, `Users`, `UserActivity`, `UserProductivity`, `IdpSync`, `LicenseAnalysis`, `LicenseImport`, `Suppliers`, `Items`, `Intercompany`, `AdvancePayments`, `FinancialReview`, `NfEntrada`, `Notifications`, `MainMenu` (h1 home)
- Qualquer `navigate("/old-url")` ou `<Link to="/old-url">` espalhado pelo app é atualizado para a URL nova (busca por `rg`).

## Riscos

- Links antigos em e-mails de aprovação (notificações antigas) quebram.
- Bookmarks dos usuários quebram.
- Qualquer integração externa que chame URLs do app precisa ser atualizada manualmente.

Confirma que posso prosseguir sem manter nenhum redirect?
