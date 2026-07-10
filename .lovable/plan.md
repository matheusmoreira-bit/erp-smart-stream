# Refatoração mobile app-like

Como o projeto tem 40+ páginas e centenas de componentes, reescrever tudo num único passo garantia regressões em massa. Vou entregar em **fases incrementais**, cada uma testável de forma isolada, mantendo os tokens atuais (teal, glass-card, Inter). Desktop preserva o layout atual; mobile ganha tratamento app-like.

## Princípios comuns (aplicados em todas as fases)

- **Bottom navigation** no mobile (`<md`) com as 4-5 rotas mais usadas + botão "Mais" que abre um `Sheet` com o menu completo.
- **`Dialog` → `Sheet` lateral/inferior** em telas `<md`. Vou criar um wrapper `<ResponsiveDialog>` que renderiza `Dialog` no desktop e `Sheet` (side="bottom") no mobile — assim os modais existentes migram com 1 linha de mudança.
- **Tabelas → cards** no mobile. Um utilitário `<ResponsiveTable>` que aceita `columns` + `renderCard(row)`.
- **Tap targets ≥ 44px**: substituir `size="sm"`/`size="icon"` por `size="default"` em ações primárias no mobile via classe `md:h-9 h-11`.
- **Header sticky** compacto no mobile: título + ações essenciais colapsam num menu.
- **Inputs**: `text-base` no mobile (evita zoom do iOS), labels acima, botões full-width nos formulários.
- **Toasts**: reposicionados para topo no mobile (não conflitam com bottom nav).

## Fase 1 — Casca global (navegação, header, notificações)

Arquivos:
- `src/components/MainMenu.tsx` — vira grid de 2 col no mobile, cards maiores, ícones grandes.
- `src/components/HubTabs.tsx` — tabs scrolláveis horizontal no mobile com snap.
- **Novo** `src/components/MobileBottomNav.tsx` — 4 ícones (Aprovações, Despesas, Notificações, Menu) + badge de contagem. Só aparece em `<md`.
- **Novo** `src/components/MobileMenuSheet.tsx` — Sheet lateral com todo o menu, agrupado.
- `src/App.tsx` — monta o BottomNav como layout global.
- `src/components/NotificationBell.tsx` — o popover vira Sheet inferior no mobile.
- Header do `Dashboard`/`Approvals`/etc. — colapsa "empresa + usuário + refresh + logout" em um menu de 3 pontos no mobile.
- `src/hooks/use-toast.ts` — reposicionar toast para `top` em mobile.

## Fase 2 — Aprovações (fluxo principal)

- `src/pages/Approvals.tsx` — cabeçalho compacto (filtros num Sheet), lista de docs vira cards full-width com ações no rodapé. Linhas do doc aberto num Sheet inferior de altura variável. Botões "Aprovar/Rejeitar" ficam **fixos no bottom** do sheet.
- `src/components/AttachmentViewer.tsx` — já é modal; ajustar para fullscreen no mobile e adicionar zoom pinch em imagens.
- `src/components/SapDocApprovalHistory.tsx` e `InternalApprovalHistory.tsx` — timeline compacta.
- `src/pages/ApprovalHistory.tsx` — mesmo padrão de cards.
- Modais de rejeição/comentário — migrar para `ResponsiveDialog`.

## Fase 3 — Despesas e Adiantamentos

- `src/pages/Expenses.tsx` + `VirtualExpensesTable.tsx` — tabela vira cards no mobile, filtros num Sheet.
- `src/components/CreateExpenseModal.tsx` + `EditExpenseModal.tsx` + `CreateAdvanceModal.tsx` — viram Sheet fullscreen no mobile com steps verticais, upload de anexo com botão grande de câmera/galeria, rateio como lista de cards empilhados.
- `src/pages/AdvancePayments.tsx` — cards + Sheet de detalhes.

## Fase 4 — Dashboards e relatórios

- `src/components/Dashboard.tsx` — grid já responsivo, mas gráficos Recharts precisam de `aspect-ratio` fixo no mobile e legendas colapsáveis.
- `src/components/PaymentAnalysis.tsx` — tabelas para cards.
- `src/pages/Analytics.tsx` — tabs viram Select no mobile.
- `src/pages/AuditConsole.tsx` + `audit-console/*` — filtros num Sheet, cards.
- `src/components/PeriodFilter.tsx` — dropdown vira Sheet no mobile.

## Fase 5 — Componentes compartilhados restantes

Migração em massa de `Dialog` → `ResponsiveDialog` nos ~30 modais restantes (CreateUser, EditPhone, ChangePassword, Confirm, PagCorp*, Supplier*, Item*, etc.). Mudança majoritariamente mecânica: swap do import.

## Detalhes técnicos

- `ResponsiveDialog` usa `useIsMobile()` (já existe em `src/hooks/use-mobile.tsx`) para escolher `Dialog` vs `Sheet side="bottom"`. Preserva a API do shadcn `Dialog` (mesmos subcomponentes `Header`/`Title`/`Description`/`Footer`/`Content`).
- Bottom nav usa `fixed bottom-0 inset-x-0 z-40 md:hidden` + `safe-area-inset-bottom` via `pb-[env(safe-area-inset-bottom)]`.
- Adicionar `pb-16 md:pb-0` no `<main>` das páginas para não esconder conteúdo atrás do bottom nav.
- `text-base` em inputs no mobile via classe global em `index.css`: `@media (max-width: 767px) { input, textarea, select { font-size: 16px; } }`.
- Zero mudanças em lógica de negócio, hooks de dados, edge functions, RLS ou tokens de design.

## Ordem de execução

Vou **entregar a Fase 1 nesta rodada** (casca global — é o que dá sensação de "app" imediata e desbloqueia tudo depois). Nas próximas mensagens você me diz se continuo direto para a Fase 2, ou se quer ajustar algo na Fase 1 primeiro.

```text
[Fase 1: navegação global]  ← agora
        ↓
[Fase 2: Aprovações]        ← próxima mensagem
        ↓
[Fase 3: Despesas]
        ↓
[Fase 4: Dashboards]
        ↓
[Fase 5: modais restantes]
```
