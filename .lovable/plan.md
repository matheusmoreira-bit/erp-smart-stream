# Buscar NF na MasterTax a partir do pedido de compra

## Objetivo
No detalhe de um pedido de compra já existente no ERP (criado no Flow e integrado, ou nativo do SAP), usuários dos grupos com acesso a "NF de Entrada" (Contábil & Fiscal e Admins) poderão procurar a nota fiscal correspondente na MasterTax, escolher entre as opções encontradas e lançar a NF de entrada ou apenas criar o esboço.

## Como vai funcionar para o usuário
1. No detalhe do pedido de compra aparece o botão "Buscar NF na MasterTax" (só para quem tem permissão e só quando o pedido já existe no ERP).
2. O sistema procura notas com o mesmo fornecedor, valor próximo e data próxima à do pedido.
3. Resultado:
   - nenhuma nota: mensagem clara e opção de ampliar o período;
   - uma ou várias: lista com número, série, fornecedor, data, valor, diferença em relação ao pedido e aviso quando a nota já está vinculada a outro pedido;
   - erro/sem permissão: mensagem específica.
4. Ao escolher uma nota, dois botões: "Lançar NF de entrada" e "Criar esboço da NF".
5. Ao concluir, o número do documento gerado no ERP é mostrado e o histórico da nota registra quem fez a ação.

## Detalhes técnicos
### Nova Edge Function `mastertax-po-nf-search`
- Autorização: `requireAdminOrSapModule(req, "nf_entrada")` (admin Cloud, admin SAP ou grupo com o módulo NF de Entrada). Nada depende do nome do grupo; a permissão continua vindo de `permission_group_modules`.
- Credenciais MasterTax e SAP lidas de `system_credentials` no servidor; nada exposto ao cliente.
- Ação `search` (`company_db`, `po_doc_entry`, `window_days` opcional, padrão 90, máximo 180):
  - lê o pedido no Service Layer (`DocEntry, DocNum, CardCode, CardName, DocDate, DocTotal, DocumentStatus`) e o CNPJ do fornecedor em `BusinessPartners`;
  - consulta a MasterTax reutilizando a normalização de `mastertax-pull` (`MasterTaxInvoice`) e também `nf_entrada_imports` já importadas da mesma empresa;
  - pontua candidatos por CNPJ do fornecedor, diferença de valor (exata / até 1% / até 5%) e proximidade de data; devolve no máximo 20 ordenados por score, com `alreadyLinkedPoDocEntry` quando já houver vínculo.
- Ação `link` (`company_db`, `po_doc_entry`, `chave_acesso`, `mode: "draft" | "post"`):
  - valida que o pedido é efetivo (esboço não pode ser faturado) e que a nota pertence à empresa (CNPJ destinatário);
  - faz upsert idempotente em `nf_entrada_imports` por `chave_acesso`, gravando `sap_matched_po_doc_entry`, `sap_matched_po_doc_num`, `sap_matched_card_code`, `sap_matched_po_is_draft = false`, `match_resolved_by/at` e `sap_match_reason = "manual_po_search"`;
  - `mode = "draft"`: mesma lógica de `nf-entrada-invoice-draft` (Draft `oPurchaseInvoices` com linhas `BaseType 22`), idempotente por `sap_invoice_draft_id`;
  - `mode = "post"`: `POST /PurchaseInvoices` com linhas `BaseType 22 / BaseEntry / BaseLine`, gravando `erp_invoice_doc_entry`, `erp_invoice_doc_num`, `erp_invoice_posted = true`, `status = "completed"`; idempotente quando já houver documento lançado;
  - registra `nf_entrada_logs` (`step: manual_po_link`) com o usuário chamador; erros voltam em `last_error` e em resposta 4xx/5xx com mensagem legível.
- Sem `USING(true)`; não altera RLS existente (a tabela `nf_entrada_imports` já é escrita apenas pelo service role nas funções).

### Frontend
- `src/hooks/useMastertaxPoSearch.ts`: chama a função com os cabeçalhos de sessão SAP já usados no projeto; expõe `search`, `link`, `loading`, `error`.
- `src/components/PoMastertaxNfDialog.tsx`: diálogo acessível com estados de carregando, vazio, erro, sem permissão; lista de candidatos selecionáveis (radio), campo de período, e as ações "Lançar NF de entrada" / "Criar esboço".
- `src/pages/Expenses.tsx` (`ExpenseDetailModal`): botão "Buscar NF na MasterTax" exibido apenas em `mode === "purchase"`, com `sap_doc_entry` presente e capacidade `nf_entrada` (via `useMyCapabilities`) ou admin. Ocultar na UI é só conveniência; a função valida no servidor.

## Verificação
- `tsgo --noEmit` e build limpos.
- Teste da função com `curl_edge_functions` para os casos: sem permissão (403), pedido inexistente (404), busca sem resultados, busca com múltiplos candidatos.
- Lançamento real no SAP deve ser testado pelo usuário com um pedido de teste antes do uso em produção.
