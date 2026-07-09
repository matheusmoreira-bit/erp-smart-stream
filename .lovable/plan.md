## Problema

Na tela "Editar Regra de Aprovação" (/aprovacoes/regras):

1. O campo **Valor** de um critério é sempre input livre — para `Centro de Custo`, `Projeto`, `Fornecedor`, `Códigos dos Itens` e `Grupos dos Itens`, o usuário quer buscar em uma lista, não digitar.
2. O seletor **Aprovador** aparece vazio ("Nenhum usuário encontrado"). O componente lê `useSapUsers`, que só popula quando há sessão SAP ativa e o Service Layer retorna Users; hoje ele não faz fallback para as fontes que já existem no app (perfis autenticados / mapeamento IdP).
3. Não é possível colocar **mais de um aprovador no mesmo nível em paralelo** (primeiro que decide encerra o nível).

## O que vou entregar

### 1. Busca em `Valor` conforme o campo do critério

Substituir o `<Input>` puro por um seletor com busca (mesmo padrão do `UserSelect` atual — Popover + Command) quando o campo suportar catálogo:

- `cost_center` → `useSapCostCenters` (já existe no app, usado no CreateExpense).
- `project` → `useSapProjects`.
- `supplier_name` → busca via `sap_cache` de fornecedores + fallback Service Layer, mesma fonte usada no modal de despesas.
- `item_codes` → busca de itens (código + descrição).
- `item_groups` → lista de grupos de itens.
- `requester_name` → usa o mesmo seletor de usuários corrigido no passo 2.
- `total_amount`, `doc_type`, `currency` → continuam como estão (número / select fixo).

Quando o operador for `like`, `contains` ou `not_contains`, o campo continua livre (padrão wildcard como `1.6.%`). Nos demais operadores, mostra o seletor.

### 2. Lista de aprovadores populada

Ajustar o `UserSelect` para não depender só de `useSapUsers`:

- Continua tentando o Service Layer (quando há sessão SAP).
- Combina com `idp_user_mapping` + `user_profiles` (usuários autenticados no ERP Flow), deduplicando por e-mail. Isso resolve o caso de empresas OMIE e o caso em que o cache SAP ainda não carregou.
- Se todas as fontes vierem vazias, mostrar mensagem explicando o motivo em vez de só "Nenhum usuário encontrado".

### 3. Aprovadores paralelos no mesmo nível

**Schema:** o modelo `approval_rule_levels` já suporta múltiplas linhas por `level_order` (não há unique em `(rule_id, level_order)`). Vou remover o "collapse" que hoje força um aprovador por nível e passar a permitir N linhas com o mesmo `level_order`.

**UI:** cada nível vira um bloco com lista de aprovadores + botão "+ Adicionar aprovador em paralelo". Mensagem clara: "Qualquer um pode responder; a primeira decisão encerra este nível".

**Engine de aprovação (crítico):** `src/lib/approval-authz.ts`, `src/lib/approvalSegments.ts` e a página `Approvals.tsx` hoje assumem 1 aprovador por nível. Vou:

- Tornar `canApprove(expense, user)` verdadeiro se o usuário bate com **qualquer** linha do `current_level_order`.
- Ao aprovar/reprovar, avançar o nível (ou finalizar como rejeitado) mesmo que existam outras linhas pendentes no mesmo nível — a primeira decisão vale.
- Notificar todos os aprovadores paralelos quando o documento chegar no nível.
- Ajustar `expense_approval_log` para registrar quem decidiu, sem exigir que os demais respondam.
- No card da regra (visualização), mostrar aprovadores do mesmo nível com o rótulo "(paralelo)".

### Arquivos afetados

- `src/pages/ApprovalRules.tsx` — seletores com busca, UI de níveis paralelos, card de regra.
- `src/hooks/useApprovalRules.ts` — remover `collapseConsecutiveApprovers`, permitir múltiplos aprovadores por nível.
- `src/lib/approval-authz.ts` — `canApprove` e cálculo de próximo aprovador com múltiplas linhas por nível.
- `src/lib/approvalSegments.ts` — segmentos e resumos que hoje leem 1 linha por nível.
- `src/pages/Approvals.tsx` / `src/hooks/useExpenses.ts` — avanço de nível considera "primeira decisão encerra".
- Notificações de aprovação: enviar para todos os aprovadores do nível atual.

## Fora do escopo

- Aprovação por quórum (ex.: 2 de 3 devem aprovar). Só implemento "primeiro decide". Se quiser quórum depois, faço em uma etapa nova.
- Mudança de schema no banco — o modelo atual já suporta múltiplas linhas por nível.
