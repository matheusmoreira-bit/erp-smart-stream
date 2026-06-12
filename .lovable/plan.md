## Plano de ajustes — PagCorp e Integração

### 1. KPI "Valor Total" separado por moeda
- Em `src/pages/PagCorp.tsx`, o cartão de Valor Total mostrará duas linhas: **R$ (BRL)** e **US$ (USD)** calculadas a partir das transações filtradas.
- Ajustar `MetricCard` (ou usar variante local) para suportar duas linhas de valor.

### 2. Fallback do mapeamento de cartão (CC / Projeto / Item)
- Em `supabase/functions/pagcorp-to-sap/index.ts`, ao montar cada linha, se `lineOverrides` não trouxer `costCenter`, `project` ou `item`, buscar o mapeamento do cartão (`pagcorp_card_mappings`) por `cardLastDigits`/`cardName` da transação e aplicar os defaults.
- No `PagCorpIntegrateDialog` e `PagCorpConsolidateDialog` (a serem unificados), pré-carregar os defaults do mapeamento por cartão e mostrá-los como valores iniciais (badge "automático").

### 3. Status "Finalizado" → "Aprovado"
- Em `PagCorpCandidateRow.tsx` e qualquer outro ponto (`PagCorp.tsx`, `pagcorp-presentation.ts`) que exibe "Finalizado" para despesa com prestação aprovada, trocar o rótulo para **Aprovado**. Sem mudança de regra de negócio.

### 4. Unificar "Integrar em Lote" + "Consolidar em 1 PC"
- Em `src/pages/PagCorp.tsx`: remover o botão "Consolidar em 1 PC". Manter apenas **Integrar em Lote**, que abre o `PagCorpConsolidateDialog` quando há ≥2 transações selecionadas (consolida em 1 PC), ou o `PagCorpIntegrateDialog` quando há 1.
- Remover handlers/estado duplicados.

### 5. Moeda automática (BRL/USD) na integração
- Em `PagCorpIntegrateDialog` e `CreateExpenseModal` (quando vem do PagCorp): inferir moeda da transação — se `currency === "BRL"` → BRL; caso contrário → USD. Preencher o campo e desabilitar/ocultar a seleção manual (com tooltip de origem).
- A mesma regra já existe parcialmente em `usePagCorp.ts`; reaproveitar.

### 6. Remover linhas com valor ≤ 0 na integração
- Em `pagcorp-to-sap/index.ts`, antes de montar `DocumentLines`, filtrar `transactions` cujo `amount <= 0`.
- Front: avisar (toast) quando linhas forem descartadas. Bloquear envio se todas forem inválidas.

### 7. Cache de sessão para arquivos processados por IA
- Novo helper `src/lib/ai-file-cache.ts` com `Map` em memória chaveado por SHA-256 do arquivo (`crypto.subtle.digest`).
- Em `CreateExpenseModal.tsx` (e onde mais a IA é chamada — `supplier-ai-extract` / `process-expense-doc`), consultar o cache antes da chamada e gravar o resultado após sucesso. Limpar no logout.

### 8. Reorganização visual do modal de integração
- Reestruturar `PagCorpIntegrateDialog` e `PagCorpConsolidateDialog` em três seções claramente separadas com títulos:
  - **Cabeçalho da Integração** — Fornecedor, Empresa, Data, Moeda (auto), Condição de pagamento, Observações.
  - **Linhas da Integração** — tabela com CC, Projeto, Item, Valor, Descrição, Anexos.
  - **Padrões aplicados (fallback)** — exibe CC/Projeto/Item padrão herdados do cartão, com badge "Automático" (cinza) vs "Editado" (azul).
- Destaque visual para campos obrigatórios (asterisco vermelho) e para valores preenchidos automaticamente (badge discreto).

### Arquivos afetados
- `src/pages/PagCorp.tsx` (KPI, unificação ações, status)
- `src/components/PagCorpCandidateRow.tsx` (status, badges)
- `src/components/PagCorpIntegrateDialog.tsx` (moeda auto, seções, fallback visual)
- `src/components/PagCorpConsolidateDialog.tsx` (seções, fallback visual, moeda)
- `src/components/CreateExpenseModal.tsx` (moeda auto, cache IA)
- `src/lib/ai-file-cache.ts` (novo)
- `src/lib/pagcorp-presentation.ts` (rótulo Aprovado, se aplicável)
- `supabase/functions/pagcorp-to-sap/index.ts` (fallback do mapeamento, filtro ≤0)

### Fora de escopo
- Mudanças no schema de banco; o fallback usa a tabela `pagcorp_card_mappings` já existente.
- Persistência do cache de IA além da sessão (somente memória).

Pode aprovar para eu executar?