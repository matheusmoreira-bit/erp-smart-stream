# Fallback e mensagem de UI para mapeamento de cartão ausente

## Objetivo
Quando o usuário abrir "Integrar Prestação de Conta" para uma transação PagCorp e não houver mapeamento (específico do cartão nem fallback da empresa) para Centro de Custo, Projeto ou Item, deixar claro na interface o que aconteceu e oferecer atalho para criar o mapeamento.

## Comportamento

1. Ao abrir o modal de integração com `origin === "pagcorp"`:
   - Resolver o mapeamento via `usePagCorpCardMapping.resolve({ cardLastDigits, cardName })`.
   - Calcular o estado do mapeamento:
     - `none` — nenhum mapeamento (nem cartão, nem fallback).
     - `partial` — algum campo (CC, Projeto ou Item) está sem valor no mapeamento aplicado.
     - `full` — todos os três campos vieram preenchidos.

2. Banner no topo do modal (logo abaixo do título), só para `origin === "pagcorp"`:
   - `full` + `source = "card"`: banner verde discreto — "Mapeamento do cartão aplicado (CC, Projeto e Item)".
   - `full` + `source = "fallback"`: banner âmbar discreto — "Aplicado o fallback da empresa. Crie um mapeamento específico para este cartão se desejar."
   - `partial`: banner âmbar listando os campos faltantes — "Mapeamento incompleto: faltando [Centro de Custo, Item]. Preencha manualmente ou edite o mapeamento."
   - `none`: banner âmbar — "Nenhum mapeamento encontrado para este cartão e não há fallback configurado. Preencha CC, Projeto e Item manualmente."
   - Todos os banners (exceto `full+card`) trazem um link "Abrir mapeamento" que abre `/cartoes/mapeamento` em nova aba já filtrado pelo cartão atual (via query `?card=<identifier>`).

3. Comportamento de fallback nos campos:
   - Campos sem valor do mapeamento permanecem vazios e exibem `placeholder` explícito: "Sem mapeamento — selecione manualmente".
   - A validação atual (CC obrigatório por item) continua barrando o envio, então o usuário é forçado a escolher antes de integrar.
   - Adicionar `aria-invalid` quando o campo estiver vazio e o usuário tentar salvar, para destacar visualmente.

4. Tela de Mapeamento (`PagCorpMapping.tsx`):
   - Ler `?card=<identifier>` na URL e, se presente, abrir o formulário de novo mapeamento já com o `card_identifier` preenchido e dar scroll/foco nele.

## Detalhes técnicos

Arquivos afetados:

- `src/components/CreateExpenseModal.tsx`
  - Após `resolveCardMapping(...)`, guardar um `mappingStatus` em estado (`none | partial | full`), `missingFields: string[]` e `source`.
  - Renderizar um componente `<CardMappingBanner />` (novo, inline ou em `src/components/PagCorpCardMappingBanner.tsx`) condicional a `origin === "pagcorp"`.
  - Manter o effect atual que aplica defaults; só não definir os campos faltantes (já é o caso). Garantir que o placeholder dos `CachedSearchCombobox` reflita o estado quando vazio (prop `placeholder`).
  - Link "Abrir mapeamento" usa `window.open(`/cartoes/mapeamento?card=${encodeURIComponent(prefill.cardLastDigits || prefill.cardName || "")}`, "_blank")`.

- `src/components/PagCorpCardMappingBanner.tsx` (novo)
  - Props: `status`, `source`, `missingFields`, `cardKey`.
  - Usa `Alert` do shadcn com variantes semânticas (`bg-amber-50 text-amber-900 border-amber-200` ou tokens equivalentes do projeto).

- `src/pages/PagCorpMapping.tsx`
  - `useSearchParams()` para ler `card`. Se presente e ainda não houver mapeamento para ele, pré-preencher o formulário de criação e dar `scrollIntoView`.

- `src/hooks/usePagCorpCardMapping.ts`
  - Sem mudança de schema. Opcional: expor um helper `describe(tx)` que retorna `{ resolved, status, missingFields, source }` para evitar duplicar a lógica no modal.

Sem mudanças de banco de dados, RLS ou edge functions.

## Fora de escopo
- Criar mapeamento direto do banner (continuamos abrindo a tela dedicada).
- Auto-criar mapeamento "rascunho" quando o usuário salvar a integração manualmente.
