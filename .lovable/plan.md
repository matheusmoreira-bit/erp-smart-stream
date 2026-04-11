
## Cancelamento em lote de integrações pendentes

### O que será feito
Adicionar checkboxes na tabela do histórico de integrações para selecionar múltiplos itens pendentes e cancelá-los em lote com um único clique.

### Implementação

**Arquivo: `src/pages/IntegrationHistory.tsx`**

1. Adicionar estado `selectedIds` (Set de IDs selecionados)
2. Adicionar import do componente `Checkbox`
3. Na coluna de header da tabela, adicionar um checkbox "selecionar todos pendentes" que seleciona/deseleciona todos os itens pendentes visíveis
4. Em cada linha com status `pending`, adicionar um checkbox individual
5. Quando há itens selecionados, exibir uma barra de ações acima da tabela com:
   - Contagem de itens selecionados
   - Botão "Cancelar selecionados" com ícone Ban
6. Criar função `cancelBatch` que faz update em lote via Supabase (`update({ status: 'cancelled' }).in('id', [...selectedIds])`)
7. Após cancelamento, limpar seleção e recarregar os logs

### Detalhes técnicos
- O checkbox "selecionar todos" só marca itens com `status === 'pending'` nos logs filtrados
- A barra de ações em lote aparece condicionalmente quando `selectedIds.size > 0`
- O update em lote usa `.in('id', ids)` do Supabase, sem necessidade de migração (RLS de update para anon já existe)
