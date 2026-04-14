

# Sugestões de Novos Módulos e Funcionalidades

Baseado na análise completa do sistema atual, que já possui: Analytics (Fluxo e Pagamentos), Despesas, Aprovações, Regras de Aprovação, PagCorp, Usuários, Synapse, Credenciais e Logs de Auditoria — seguem propostas organizadas por categoria.

---

## A. Novos Módulos

### 1. **Contratos**
Gestão centralizada de contratos com fornecedores e prestadores de serviço.
- Cadastro com valor, vigência, renovação automática, alertas de vencimento
- Vinculação a parceiros de negócio do ERP (SAP/OMIE)
- Dashboard com contratos vencendo nos próximos 30/60/90 dias
- Módulo de permissão: `contracts`

### 2. **Orçamentos (Budget)**
Controle orçamentário por centro de custo, projeto ou departamento.
- Definição de teto por período (mensal/trimestral/anual)
- Consumo em tempo real cruzando com despesas e contas a pagar do ERP
- Alertas automáticos ao atingir 80%/100% do orçamento
- Bloqueio de aprovações quando orçamento estourado
- Módulo de permissão: `budget`

### 3. **Notas Fiscais (NF-e / NFS-e)**
Consulta e gestão de documentos fiscais de entrada e saída.
- Importação automática via API do ERP (OMIE já tem endpoints, SAP via DI API)
- Visualização de XML, DANFE, status de escrituração
- Conciliação: NF vs pedido de compra vs recebimento
- Módulo de permissão: `invoices`

### 4. **Relatórios e Exportações**
Módulo dedicado para geração de relatórios customizáveis.
- Templates pré-configurados (aging de contas a pagar, fluxo de caixa, DRE simplificado)
- Exportação em PDF/Excel/CSV
- Agendamento de envio automático por e-mail
- Integração com o ReportAiChat já existente para perguntas em linguagem natural
- Módulo de permissão: `reports`

### 5. **Central de Notificações**
Sistema de alertas e notificações em tempo real.
- Notificações in-app (sino no header) + e-mail configurável
- Eventos: aprovações pendentes, contratos vencendo, orçamento excedido, falhas de integração
- Preferências por usuário (quais eventos receber, por qual canal)
- Módulo de permissão: acessível a todos (sem restrição)

---

## B. Funcionalidades de Expansão (módulos existentes)

### 6. **Dashboard Executivo (Analytics)**
Painel consolidado multi-empresa para gestão corporativa.
- Visão comparativa entre empresas (receita, despesas, fluxo)
- KPIs executivos: burn rate, runway, margem operacional
- Drill-down por empresa individual

### 7. **Workflow de Despesas com OCR (Expenses)**
Aprimoramento do fluxo de despesas existente.
- Upload de comprovante com extração automática via IA (já existe `process-expense-doc`)
- Categorização automática sugerida pelo modelo
- Detecção de duplicidade

### 8. **Conciliação Bancária (PagCorp)**
Cruzamento de extratos bancários com lançamentos no ERP.
- Import de OFX/CSV do banco
- Match automático por valor + data + parceiro
- Tela de conciliação manual para exceções

### 9. **Histórico de Alterações em Cadastros (Audit Log)**
Expandir o audit log para rastrear mudanças em registros do ERP.
- Diff visual (antes/depois) para alterações em parceiros, itens, contas contábeis
- Filtro por tipo de entidade e responsável

### 10. **API Pública / Webhooks**
Permitir que sistemas externos consumam eventos do backoffice.
- Webhooks configuráveis por evento (despesa aprovada, pagamento realizado)
- API REST documentada com Swagger/OpenAPI
- Autenticação por API Key gerenciada no módulo Credenciais

---

## Prioridade Sugerida

| Prioridade | Item | Justificativa |
|-----------|------|---------------|
| P1 | Orçamentos | Controle financeiro crítico, complementa despesas e aprovações |
| P1 | Central de Notificações | Melhora UX e reduz tempo de reação |
| P1 | Dashboard Executivo | Alto valor para gestores |
| P2 | Notas Fiscais | Compliance fiscal, alta demanda |
| P2 | Relatórios | Automação de reporting |
| P2 | OCR em Despesas | Já existe base (process-expense-doc) |
| P3 | Contratos | Gestão administrativa |
| P3 | Conciliação Bancária | Complemento financeiro |
| P3 | Histórico de Cadastros | Governança |
| P3 | API/Webhooks | Ecossistema e extensibilidade |

---

Selecione quais módulos ou funcionalidades deseja implementar e posso criar o plano detalhado de execução para cada um.

