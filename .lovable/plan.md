# Ciclo de Vendas completo

Hoje `/vendas` é uma tela única de baixas de recebimento. Vamos transformá-la em um hub com três submódulos, cobrindo o ciclo: **Pedido de Venda → NFS-e → Contas a Receber**.

```text
Pedido de Venda  →  Aprovação (motor atual)  →  SAP /Orders
        ↓
      NFS-e       →  SAP /Invoices  →  TaxOne autoriza  →  nº NFS-e
        ↓
 Contas a Receber →  baixa do recebimento (fluxo atual)
```

## 1. Navegação

- `/vendas` passa a ser um hub com três abas/rotas:
  - `/vendas/pedidos` — Pedido de Venda
  - `/vendas/nfse` — Emissão e acompanhamento de NFS-e
  - `/vendas/recebimentos` — visão atual (contas a receber / baixas)
- `/vendas` redireciona para a aba padrão conforme permissão; `/vendas/historico` permanece.
- Controle de acesso continua via `useModuleAccess` (grupo Financeiro - Contas a Receber + super-admin), com uma ação nova por submódulo para permitir, por exemplo, comercial criando pedido sem acessar baixas.

## 2. Pedido de Venda

- Novo formulário `CreateSalesOrderModal`, espelhando o layout e a ergonomia do formulário de pedido de compras (cabeçalho, itens, rateio por CC/projeto, anexos, totais, impostos), trocando fornecedor por **cliente**.
- Cliente: busca no SAP `BusinessPartners` com `CardType eq 'cCustomer'`, mostrando código, nome e CNPJ/CPF.
- Itens: reaproveita a busca de itens já usada nas despesas, com preço unitário e quantidade editáveis.
- Rascunho salvo no ERP Flow; submissão dispara o fluxo de aprovação.

## 3. Aprovação

- Reutiliza o motor atual (`approval_rules` / `approval_rule_levels`, substitutos, histórico, notificações), com os pedidos de venda entrando como um novo tipo de documento.
- As telas de Aprovações e Histórico passam a exibir também pedidos de venda, com filtro por tipo.
- Só após aprovação total o pedido é integrado ao SAP em `/Orders` (por edge function), gravando `DocEntry`/`DocNum` de volta.

## 4. NFS-e

- Lista os pedidos aprovados e já integrados, com saldo ainda não faturado.
- Ação "Emitir NFS-e": cria `Invoices` no SAP a partir do pedido (`BaseType 17`, `BaseEntry`, `BaseLine`), respeitando filial (BPLID) e série, com faturamento total ou parcial por linha.
- Após criar, acompanha a autorização consultando `SBO_TaxOne` (mesma lógica já usada em `sap-nfse-lookup`): status, número da NFS-e, RPS, série e data de autorização, com atualização por polling e reprocessamento manual em caso de rejeição.
- Modal de confirmação antes da emissão, no padrão já adotado nas baixas.

## 5. Contas a Receber

- Mantém integralmente o comportamento atual (listagem de faturas em aberto, saldos iniciais SI, mapa de relações, baixas), apenas movida para a nova rota/aba.

## Detalhes técnicos

- **Banco**: novas tabelas `sales_orders`, `sales_order_items` (rateio por CC/projeto), `sales_order_attachments` e `sales_order_invoices` (vínculo pedido ↔ NFS-e ↔ status TaxOne). RLS por empresa/criador/aprovador, seguindo a regra de visibilidade já vigente (usuário vê o que criou ou aprova; admin com toggle "Ver todos"), com GRANTs explícitos.
- **Edge functions** (service role, validação de JWT e de empresa em código):
  - `sales-order-mutation` — criar/editar/submeter rascunho.
  - `sales-order-to-sap` — integra o pedido aprovado em `/Orders`, com retry na fila existente.
  - `sales-nfse-emit` — cria a Invoice a partir do pedido.
  - `sales-nfse-status` — consulta TaxOne/`sap-nfse-lookup` e atualiza status.
- Nenhum segredo no front; toda chamada ao SAP/HanaAPI continua server-side.
- Estados de loading, vazio, erro, dados insuficientes e sem permissão em todas as telas novas.

## Entrega sugerida em fases

1. Hub de navegação + mover a visão atual para Contas a Receber (sem mudança funcional).
2. Pedido de Venda (tabelas, formulário, aprovação, integração SAP).
3. NFS-e (emissão + acompanhamento TaxOne).
