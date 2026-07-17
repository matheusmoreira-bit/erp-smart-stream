## Objetivo

Substituir a visualização atual da página `AuditCrossFiscal` (tabela + tabs) por um Kanban de 3 raias, onde cada card é um documento/pagamento e a raia representa o status da conciliação.

## Raias

```text
┌─────────────────────┬─────────────────────┬─────────────────────┐
│  ERP (só pago)      │  AMBOS (conciliado) │  MasterTax (só NF)  │
│  cenario =          │  cenario =          │  cenario =          │
│  pago_sem_nota      │  conciliado         │  nota_sem_pagamento │
├─────────────────────┼─────────────────────┼─────────────────────┤
│ [Card pagamento]    │ [Card NF ↔ pagto]   │ [Card NF]           │
│ Fornecedor          │ Fornecedor          │ Fornecedor          │
│ CNPJ                │ CNPJ                │ CNPJ                │
│ Valor pago          │ NF nº · valor       │ NF nº · valor       │
│ Data baixa          │ Pagto · data · valor│ Data emissão        │
│ Forma pagto         │ Δ R$ · Δ dias       │ Chave acesso        │
│ [→ ERP]             │ score · status      │                     │
│                     │ [→ ERP]             │                     │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

- Contadores no topo de cada raia: quantidade + soma R$.
- Filtros mantidos: empresa (sessão), período início/fim, botão **Executar cruzamento** e **Atualizar**.
- Busca por CNPJ/fornecedor/nº NF acima das raias.
- Filtro por status_match (automatico / ambiguo / confirmado_manual / ignorado) com chips.

## Card

- Componente reutilizável `CruzamentoCard` com 3 variantes visuais (por raia).
- Cor de borda por raia: destrutivo (ERP), sucesso (AMBOS), aviso (MasterTax).
- Ações no card (menu ⋯):
  - Abrir origem no ERP (quando `conta_paga_link_origem` existe).
  - Confirmar (para status `ambiguo`).
  - Ignorar (marca `status_match = ignorado`).
  - Ver detalhes (drawer lateral com JSON completo, candidatos ambíguos, diferenças).
- Badge de `status_match` no rodapé.
- Scroll vertical dentro da raia; raias ocupam altura da viewport (`h-[calc(100vh-...)]`).

## Interações

- Clique no card → abre `Drawer` (shadcn `sheet`) com todos os campos e o histórico da linha.
- Botão **Exportar CSV** aplicado à raia visível ou ao conjunto filtrado (mantém a lógica existente em `toCsv`).
- Empty state por raia com CTA para "Executar cruzamento" quando não há dados.

## Escopo técnico

Alterações apenas em frontend — motor (`audit-cross-fiscal-run`), hook (`useAuditCrossFiscal`) e schema permanecem inalterados.

**Arquivos**:
- `src/pages/AuditCrossFiscal.tsx` — troca layout de Tabs/Table por Kanban de 3 colunas.
- `src/components/audit-cross/CruzamentoCard.tsx` (novo) — card individual.
- `src/components/audit-cross/CruzamentoDetailDrawer.tsx` (novo) — drawer de detalhes.
- `src/components/audit-cross/KanbanColumn.tsx` (novo) — raia com header (título, contador, total, empty state) e área rolável.

**Sem drag & drop**: mover cards entre raias não faz sentido semântico (a raia é derivada do cenário). Ações discretas via menu no card já cobrem os fluxos manuais (`confirmado_manual` / `ignorado`).

**Responsivo**: em telas <lg, colunas empilham verticalmente; em ≥lg, grid 3 colunas.

## Fora do escopo

- Rodar o cruzamento nas bases produtivas (`SBO_ANAGAMING`, `SBO_CACTUS`) — hoje sem notas do MasterTax capturadas; tratar em passo separado depois que os pulls estiverem populando.
- Corrigir as 4 notas com `sap_company_db` nulo — item de saneamento independente.
- Cron automático do cruzamento.
