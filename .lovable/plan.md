# PagCorp – Cartões Indedutíveis

## Objetivo
Permitir marcar certos cartões/portadores como **indedutíveis** (isentos de prestação de contas, aprovação e anexos). As despesas desses cartões são integradas ao SAP **de forma unificada (1 único Pedido de Compra)** para um fornecedor fixo mapeado.

## 1. Nova tabela: `pagcorp_nondeductible_cards`
Mapeia cartão → fornecedor SAP por empresa.

Colunas:
- `id` uuid pk
- `company_db` text not null
- `card_identifier` text not null — chave do cartão no PagCorp (cardId, cardName ou lastDigits, ver §Técnico)
- `card_label` text — nome amigável p/ exibição
- `card_holder` text — portador (opcional)
- `supplier_code` text not null — CardCode SAP
- `supplier_name` text
- `created_at`, `updated_at`, `created_by`
- UNIQUE (`company_db`, `card_identifier`)

RLS: leitura por `authenticated`, escrita só admin. GRANTs padrão.

## 2. Nova tela: `/pagcorp/nondeductible` (Cartões Indedutíveis)
- Seletor de empresa (companyDB)
- Tabela: cartão, portador, fornecedor SAP, ações (editar / remover)
- Botão "Adicionar cartão indedutível" abre modal:
  - Combobox de cartões (lista distinta vinda das transações PagCorp da empresa)
  - `SapSearchCombobox` de Fornecedor (mesmo padrão do `PagCorpConsolidateDialog`)
- Acesso via MainMenu dentro do grupo PagCorp (somente admin).

## 3. Tela `/pagcorp` (Despesas)
- Novo **toggle** no header: "Mostrar indedutíveis" (off por padrão → mostra só dedutíveis).
  - Off: oculta linhas cujo cartão está mapeado como indedutível.
  - On: mostra todas, com badge "Indedutível" nas linhas correspondentes.
- Despesas indedutíveis:
  - Ignoram validações de prestação de contas / aprovação / anexos no fluxo.
  - Botão extra no header (quando toggle On e houver indedutíveis no período): **"Integrar indedutíveis"** → cria 1 PC consolidado por fornecedor mapeado (reusa `integrateConsolidated`).
- Marcação visual: badge cinza "Indedutível".

## 4. Backend
- Hook `useNondeductibleCards(companyDb)` (CRUD direto via supabase client).
- Em `usePagCorp.fetchTransactions`: após carregar transações, carregar mapeamentos e anotar `isNondeductible: boolean` + `nondeductibleSupplierCode/Name` em cada transação.
- `pagcorp-to-sap` já aceita `transactions[]` consolidados — reusar sem mudanças.

## Técnico
- Chave do cartão: usar `cardLastDigits` quando presente, senão `cardName`. Armazenar exatamente o que veio para casar 1:1.
- Reutilizar:
  - `SapSearchCombobox` (BusinessPartners) para fornecedor.
  - `PagCorpConsolidateDialog` lógica via `integrateConsolidated`.
- Migration cria tabela + GRANTs + RLS + políticas (admin write, authenticated read) seguindo o padrão do projeto.
- Atualizar memória do projeto se necessário (regra de visibilidade já está ok).

## Arquivos novos / editados
Novos:
- `supabase/migrations/<ts>_pagcorp_nondeductible_cards.sql`
- `src/hooks/useNondeductibleCards.ts`
- `src/pages/PagCorpNondeductible.tsx`
- `src/components/PagCorpNondeductibleDialog.tsx` (add/edit mapeamento)

Editados:
- `src/App.tsx` — rota nova
- `src/components/MainMenu.tsx` — item de menu (admin)
- `src/hooks/usePagCorp.ts` — anotar `isNondeductible`
- `src/pages/PagCorp.tsx` — toggle, badge, botão "Integrar indedutíveis"
