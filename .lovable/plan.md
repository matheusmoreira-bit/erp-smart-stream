# CNAB de pagamento em modo standalone (sem SAP)

## Objetivo
Com o SAP fora do ar (previsão: final de 20/10, por alguns dias), o time financeiro precisa continuar gerando remessas CNAB 240 Sicoob pelo ERP Flow. A base vai ser os pedidos de compra aprovados no Flow e os dados de pagamento do fornecedor. Quando o SAP voltar, tudo o que foi pago é conciliado e baixado no SAP, sem pagamento duplicado.

## Como funciona para o usuário
1. O admin liga o modo standalone da empresa (o mesmo que já existe).
2. Contas a Pagar mostra um aviso "Modo standalone — títulos vindos do ERP Flow" e troca a origem da lista:
   - **Normal:** NFs de entrada abertas no SAP (como hoje).
   - **Standalone:** pedidos de compra do Flow com status Aprovado, PC lançado, NF de entrada ou Pagamento que ainda não foram pagos nem estão em outra remessa. Os documentos marcados como "Backup SAP antigo" ficam de fora.
3. Filtros: vencimento (de/até), fornecedor, forma de pagamento (boleto/PIX/TED), status do pedido, centro de custo/projeto, "somente com dados bancários completos".
4. Cada linha mostra fornecedor, CNPJ, nº do pedido/PC, vencimento, valor (itens + frete), forma de pagamento e um indicador de prontidão: pronto, falta código de barras, falta chave PIX/conta, fornecedor sem perfil aprovado.
5. O usuário escolhe os títulos, informa o código de barras quando for boleto, e gera a remessa. A remessa passa pela mesma aprovação de lote que já existe (dupla checagem) antes do download.
6. O retorno (.RET) é importado normalmente: a ocorrência 00 marca o título como **pago no banco, aguardando baixa no SAP**. O pedido do Flow passa para "Pagamento".
7. Quando o modo standalone é desligado, uma tela de **Conciliação pós-standalone** lista os pagos no período e envia ao SAP a baixa (VendorPayment) contra a NF correspondente. Se ainda não houver NF no SAP, o título fica pendente com aviso até a NF ser lançada.

## Regras de segurança e negócio
- Valor do título = total aprovado no Flow (itens + frete), na moeda BRL. Pedidos em outra moeda ficam bloqueados.
- Pagamento parcial/parcelas: primeira versão usa uma parcela por pedido, com o vencimento do pedido. Parcelas ficam para uma segunda fase.
- Dados bancários só vêm do perfil de pagamento do fornecedor **aprovado** (fluxo que já existe, com dupla aprovação). Nada é digitado solto na remessa, exceto o código de barras do boleto.
- Travas contra pagamento duplicado: um pedido em remessa ativa não reaparece; a chave de idempotência inclui a origem (Flow ou SAP) e o ID; na volta do SAP, antes de baixar, o sistema confere se a NF já está fechada.
- Acesso: admin ou permissão em `financial_review`, empresa da sessão igual à da requisição, sem exigir sessão SAP no modo standalone.
- Auditoria de cada lote, aprovação, download, retorno e baixa posterior.

## Preparação antes de 20/10 (checklist operacional)
- Cadastrar e aprovar o perfil de pagamento (banco/PIX) dos fornecedores recorrentes. Vou gerar um relatório dos fornecedores com pedidos aprovados que ainda não têm perfil aprovado.
- Copiar os cadastros do ERP (botão já existente) em 19–20/10.
- Homologar com o Sicoob uma remessa de teste gerada em modo standalone na empresa de teste.
- Ensaio geral: ligar o standalone na empresa de teste, gerar remessa, importar retorno e fazer a conciliação.

## Fora de escopo
Outros bancos além do Sicoob, tributos (DARF/GPS), moeda estrangeira, parcelamento, lançamento contábil fora do SAP.

## Detalhes técnicos
- **Banco (migração):** em `accounts_payable_batch_items`, adicionar `source text not null default 'sap'` (`'sap' | 'flow'`), `expense_id uuid null`, `sap_settlement_status text` (`not_required | pending | settled | error`), com índice único parcial `(company_db, expense_id)` para status ativos. `sap_doc_entry`/`installment_id` passam a aceitar nulo quando `source='flow'`. Trigger de validação garante consistência entre origem e colunas.
- **Edge function `accounts-payable-cnab`:**
  - `list_open`: se `getStandaloneMode(companyDb)` estiver ativo (ou `source='flow'` for pedido explicitamente por admin), chama um novo `listFlowTitles()` que lê `expenses` (tipo compra, status elegível, `sap_legacy_backup=false`, moeda BRL), junta com `accounts_payable_supplier_payment_profiles` aprovado e exclui itens em remessa ativa. Não usa `withSap`.
  - `generate`: pula a releitura de saldo no SAP para `source='flow'`, e em vez disso relê o pedido no banco (status, valor, fornecedor) e bloqueia se houver mudança depois da seleção.
  - `process_return`: para `source='flow'`, marca item pago, `sap_settlement_status='pending'`, atualiza o status do pedido e grava auditoria. Não chama o SAP.
  - Nova ação `settle_pending_in_sap`: com o standalone desligado, localiza a NF no SAP pelo PC (`sap_doc_entry` do pedido), confere o saldo e cria o `VendorPayment`, de forma idempotente.
- **Gerador CNAB (`_shared/sicoob-cnab240.ts`):** sem mudança de layout; só recebe títulos de origem Flow com a referência `FLOW-<id curto>` no campo da empresa.
- **Frontend (`src/pages/AccountsPayable.tsx`):** banner de modo, novos filtros, coluna de prontidão, aba "Conciliação pós-standalone". Busca segue o padrão `useSearchState` (3 caracteres, 400 ms).
- **Relatório de prontidão:** consulta de fornecedores com pedidos elegíveis sem perfil aprovado, exportada em planilha.
- **Testes:** unitários do filtro de elegibilidade e da idempotência; teste do gerador com títulos Flow; ensaio ponta a ponta na empresa de teste.

## Fases
1. Migração + listagem Flow + filtros + prontidão (tela).
2. Geração/aprovação/download com origem Flow + importação de retorno.
3. Conciliação pós-standalone (baixa no SAP).
4. Relatório de fornecedores sem perfil + ensaio na empresa de teste + homologação Sicoob (até ~15/10).
