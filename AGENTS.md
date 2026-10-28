# AGENTS
- SAP history reconciliation stores proven draft/final metadata in raw, splits exact directory identities, and suppresses only same-draft/person duplicate sources; HANA document dates remain explicitly non-individual — avoids provisional order numbers and invented authorship/time.
- Approval History uses exact normalized identity aliases from the canonical directory; its optional n8n webhook cannot block the audit/HANA phases, and final status is error only when both phases fail — preserves personal filtering and independent final-decision sources.
- Approval-history sync plans audit merges in memory and writes batches, keeps successful audit checkpoints per company independent of the global display state, bounds remote calls, and finalizes owned state/locks in finally; scheduler calls use the shared automation auth — avoids per-decision latency, lost retries, and unauthenticated automation.
- Buscas usam useSearchState/useEffectiveSearch (src/hooks/useSearchState.ts): mínimo 3 caracteres, 400 ms de espera, sem match aproximado — padrão único de busca em todo o app.

- Contas a Pagar em modo standalone lista pedidos do Flow (source=flow) e trava o pedido via expenses.payment_lock_batch_item_id; a baixa no SAP só ocorre na conciliação pós-standalone — evita pagamento duplicado e edição de pedido já remetido.

- A idempotência da criação de pedidos (expense-mutation) usa conteúdo + hash dos anexos + boleto e só vale por 10 min sem chave explícita — pedidos iguais com NFs diferentes são legítimos; duplicidade de documento fica em submitted_document_hashes.
- "Minhas decisões" no Histórico de Aprovações usa action=list_mine: identidade (aliases), empresas acessíveis e período são resolvidos no servidor a partir do JWT/sessão SAP, com teto de 5.000 linhas por fonte — o cliente nunca informa aliases.
