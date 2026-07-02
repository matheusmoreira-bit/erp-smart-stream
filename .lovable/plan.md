
# Esboços de Pedidos de Compra e Venda

Salvar automaticamente o preenchimento do modal de novo pedido, permitir retomar de onde parou e expirar em 15 dias.

## Comportamento

- Ao abrir o modal de "Novo Pedido" (compra ou venda) e o usuário começar a digitar, o sistema cria/atualiza um **esboço** vinculado ao usuário + empresa + tipo (compra/venda).
- Salvamento automático com **debounce de ~1s** a cada alteração (fornecedor/cliente, moeda, datas, observações, itens, centro de custo, projeto, arquivos anexados são registrados por nome — o binário fica no bucket só quando o pedido for efetivamente criado).
- Ao **enviar o pedido**, o esboço correspondente é apagado.
- Ao **fechar o modal sem enviar**, o esboço permanece.
- Novo botão **"Esboços" com contador** no topo das telas de Compras (`/pages/Expenses.tsx`) e Vendas (`/pages/Sales.tsx`), ao lado do "+ Novo Pedido".
- Ao clicar em um esboço da lista, o modal reabre já preenchido com os dados salvos.
- Esboços expiram automaticamente após **15 dias** desde a última alteração (limpeza no acesso à listagem + índice para varredura futura).

## Escopo

- Documento tipo `purchase` (Expenses) e `sales` (Sales).
- Um esboço por (usuário, empresa, tipo) — se o usuário já tem um esboço aberto e começa outro, atualiza o mesmo. A lista mostra todos, mas na prática costuma ter 1 por tipo.

Adiantamentos e outros documentos ficam fora desta primeira versão.

## Detalhes técnicos

### Banco

Nova tabela `public.document_drafts`:

- `id uuid pk`
- `user_id uuid` (auth.uid do dono)
- `company_db text`
- `doc_type text check in ('purchase','sales')`
- `payload jsonb` — snapshot dos campos do formulário (supplier, currency, dates, remarks, items, headerCostCenter, headerProject, file names/sizes)
- `preview text` — resumo curto para a lista (ex.: "VDARA — R$ 1.200,00 · 3 itens")
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `expires_at timestamptz default now() + interval '15 days'`

Índice em `(user_id, company_db, doc_type)` e em `expires_at`.

RLS: usuário só vê/edita/apaga os próprios (`auth.uid() = user_id`). GRANTs padrão para `authenticated` + `service_role`.

Limpeza: `DELETE FROM document_drafts WHERE expires_at < now()` executado no hook de listagem (barato, pouca linha por usuário). Sem cron nesta versão.

### Frontend

- Novo hook `src/hooks/useDocumentDrafts.ts`:
  - `useDrafts(docType)` — lista + contador.
  - `saveDraft(docType, payload, preview)` — upsert por `(user_id, company_db, doc_type)`.
  - `deleteDraft(id)`.
  - `purgeExpired()` — chamado ao montar.
- Em `CreateExpenseModal.tsx`:
  - Novo prop opcional `initialDraft` para hidratar o form.
  - `useEffect` com debounce salvando o estado atual quando `open === true` e há qualquer campo preenchido.
  - Ao concluir criação com sucesso, chama `deleteDraft`.
- Novo componente `src/components/DraftsPopover.tsx` — botão "Esboços (N)" que abre um popover listando os esboços daquele tipo com botão "Retomar" e "Descartar".
- Renderizado em `Expenses.tsx` (compra) e `Sales.tsx` (venda), próximo ao botão de novo pedido.

### Fora do escopo

- Não persistir binários dos anexos no esboço (só metadados). Ao retomar, mostrar aviso "Reanexe os arquivos" se havia algum.
- Adiantamentos, NF Entrada e outros fluxos ficam para depois.
