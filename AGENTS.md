# AGENTS
- Buscas usam useSearchState/useEffectiveSearch (src/hooks/useSearchState.ts): mínimo 3 caracteres, 400 ms de espera, sem match aproximado — padrão único de busca em todo o app.

- Contas a Pagar em modo standalone lista pedidos do Flow (source=flow) e trava o pedido via expenses.payment_lock_batch_item_id; a baixa no SAP só ocorre na conciliação pós-standalone — evita pagamento duplicado e edição de pedido já remetido.
