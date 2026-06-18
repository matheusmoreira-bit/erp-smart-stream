# Acessos ao Mapa de Relações

Hoje o Mapa de Relações só abre automaticamente logo após criar um pedido em `/expenses`. Vou adicionar pontos de entrada para reabri‑lo em pedidos já existentes nas 4 telas pedidas.

## Onde vai aparecer

1. **Pedidos de Compra (`/expenses`)** — botão ícone "Mapa de relações" (ícone `GitBranch`/`Network`) em cada `ExpenseCard`, ao lado das ações já existentes.
2. **Aprovações (`/approvals`)** — botão "Mapa de relações" em cada item da fila, para o aprovador ver o histórico antes de decidir e também depois (a tela já lista pedidos após decisão quando "Ver todos" está ligado).
3. **Histórico de Aprovações (`/approvals?tab=history`)** — botão "Mapa de relações" em cada linha do histórico.
4. **Modal de detalhes do pedido (`EditExpenseModal`)** — nova seção/aba "Mapa de relações" embutida (ou botão no rodapé que abre o modal por cima), mostrando o mesmo conteúdo do componente `RelationsMap`.

## Como vai funcionar

- Reutiliza o componente existente `src/components/RelationsMap.tsx` sem alterações de layout.
- Cada tela mantém um estado local `relationsMapExpense` e renderiza `<RelationsMap open onClose expense={...} />`.
- O componente já busca sozinho `expense_approval_log` + `approval_rule_levels` pelo `expense.id` e `approval_rule_id`, então basta passar o objeto do pedido selecionado.
- Botão padronizado: ícone + tooltip "Mapa de relações" em telas com cards/linhas densas; rótulo completo no modal de detalhes.

## Arquivos a alterar

- `src/pages/Expenses.tsx` — adicionar botão no `ExpenseCard` (já tem `relationsMapExpense` para o fluxo pós‑criação; só estender para clique manual).
- `src/pages/Approvals.tsx` — novo estado + botão por linha + render do `<RelationsMap />`.
- `src/pages/ApprovalHistory.tsx` — idem.
- `src/components/EditExpenseModal.tsx` — botão "Ver mapa de relações" no header/rodapé que abre o `<RelationsMap />` por cima do modal de edição.

## Fora de escopo

- Sem mudanças no schema, RLS ou no próprio componente `RelationsMap`.
- Sem mudar a abertura automática pós‑criação em `/expenses` (continua igual).
