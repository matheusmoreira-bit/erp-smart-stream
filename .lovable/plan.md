## Objetivo
Reformar as telas de Permissões do backoffice com pegada "menu iOS", tornar as ações explícitas por módulo (ver / criar / editar / excluir) e por capacidades transversais (ver tudo, delegar, etc.), garantir que a atribuição do usuário vale para todas as empresas (já vale — reforçar UI/copy), e consolidar os grupos "Aprovador" e "Usuário" em um único grupo "Usuário".

## Premissa a confirmar
"O grupo Aprovador e Usuario são identicos, migre todos para o grupo usuário e remova o grupo usuario" — interpretando como: **mesclar `Aprovador` no `Usuário` e apagar o grupo `Aprovador`**. Se for o contrário (manter `Aprovador` e apagar `Usuário`), me avise antes de aprovar.

## Modelo de dados

Hoje `permission_group_modules` guarda apenas `(group_id, module_key)` — booleano de acesso. Vamos passar para granularidade por ação:

```text
permission_group_modules
  group_id        uuid
  module_key      text
  can_view        bool  default true
  can_create      bool  default false
  can_edit        bool  default false
  can_delete      bool  default false
  PK (group_id, module_key)
```

Backfill: toda linha existente vira `can_view=true, can_create=true, can_edit=true, can_delete=true` (comportamento atual = acesso total ao módulo, sem regressão).

Módulos que não têm sentido de CRUD (ex.: `analytics`, `audit_log`, `notifications`) exibem só o toggle "Acessar"; os demais exibem os 4 checkboxes.

## Capacidades explícitas (flags transversais no grupo)

Ficam como "módulos" especiais de permissão (linhas em `permission_group_modules` com `module_key` dedicado). Já existem `approvals_view_all`, `expenses_view_all`. Adicionar/renomear na constante `ALL_MODULES` como categoria "Capacidades":

- `docs_view_all` — Ver todos os documentos (não só os próprios)
- `approvals_view_all` — Ver todas as aprovações
- `approvals_delegate` — Delegar aprovações
- `approvals_transfer` — Transferir aprovações em massa
- `approvals_override` — Aprovar fora do fluxo (admin-like)
- `suppliers_reactivate` — Reativar fornecedor inativo
- `expenses_cancel` — Cancelar documento próprio/de terceiros

(Lista final ajusto conforme o que o app já checa; sem inventar capacidades que nenhum lugar consome.)

## UI — "menu iOS"

Substituir a tela atual (duas seções empilhadas com tabela) por navegação em drill-in:

```text
┌ Permissões ────────────────────┐
│  Grupos                     >  │  ← lista rolável, cada linha com chevron
│  Usuários                   >  │
└────────────────────────────────┘
```

- **Lista de grupos**: cartões estilo iOS (fundo `card`, bordas arredondadas 2xl, separadores 1px, tap-target ≥ 44px). Cada linha mostra nome + contagem de módulos + chevron. Botão "+" no header abre criador.
- **Detalhe do grupo**: header com back, nome editável, descrição, e uma "settings-list" agrupada:
  - Seção "Capacidades" (as flags transversais) — cada linha com Switch.
  - Seção "Módulos" — cada módulo é uma linha expansível; ao expandir revela 4 toggles (Ver, Criar, Editar, Excluir). Um toggle mestre "Acesso" na linha desliga tudo.
- **Lista de usuários**: search sticky no topo, cada item mostra nome/email e o grupo atual como badge âmbar; toque abre um action sheet (`Sheet` do shadcn, bottom) com a lista de grupos para escolher — sem `Select` inline, muito mais mobile-first.
- **Mensagem global**: banner curto reforçando que a atribuição vale para **todas as empresas** (independente do ERP).

Paleta segue o padrão do backoffice já ajustado (âmbar Cactus como destaque, verde para confirmação, preto/branco base).

## Migração de dados

1. Adicionar colunas `can_view/can_create/can_edit/can_delete` em `permission_group_modules` com defaults `true` para preservar comportamento.
2. Encontrar grupo `Aprovador` (case-insensitive). Para cada `user_group_assignments` que aponta pra ele:
   - Reatribuir ao grupo `Usuário` (upsert em `(sap_email, group_id)`).
3. Copiar módulos de `Aprovador` para `Usuário` (união, sem sobrescrever flags mais permissivas).
4. `DELETE FROM permission_groups WHERE lower(name)='aprovador'`.

Migração idempotente (guardas `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

## Consumo no app

- `usePermissions.ts`: `useModuleAccess` passa a expor `{ hasAccess, can: { view, create, edit, delete }, capabilities: Set<string> }`. `hasAccess` continua = `can.view` para compat.
- `ALL_MODULES`: reorganizar em duas listas `MODULES` (com CRUD) e `CAPABILITIES` (flags booleanas).
- Callers atuais (`useModuleAccess("expenses")` etc.) continuam funcionando sem mudança porque `hasAccess = can.view`. Ações destrutivas (delete button em Expenses, Suppliers) passam a checar `can.delete` — vou aplicar só nos lugares mais críticos nesta iteração; o resto fica como TODO explícito para não estourar o escopo.

## Escopo desta entrega

Feito:
- Migração SQL (colunas + merge Aprovador→Usuário).
- Novo `PermissionManager` com layout iOS drill-in.
- Hook atualizado + tipos.
- Aplicar `can.delete/edit/create` em 2-3 pontos críticos como referência (Expenses row actions, Suppliers row actions).

Fora do escopo (fica para próxima rodada, listado para você saber):
- Aplicar `can.*` em todas as ~40 telas.
- Renomear `expenses_view_all` → `docs_view_all` globalmente (mantido como alias por ora).

## Arquivos que devem mudar

- `supabase/migrations/<novo>.sql` — schema + backfill + merge de grupos.
- `src/hooks/usePermissions.ts` — novo shape, novas constantes.
- `src/components/PermissionManager.tsx` — reescrito, drill-in.
- (Novo) `src/components/permissions/GroupsList.tsx`, `GroupDetail.tsx`, `UsersList.tsx`, `AssignSheet.tsx`.
- `src/integrations/supabase/types.ts` — regenerado após migração.
- 2-3 telas que passam a checar `can.delete/edit` como prova de conceito.

## Perguntas rápidas
1. Confirma o merge **Aprovador → Usuário** (apaga `Aprovador`)?
2. Ok manter compat: quem hoje só tem "acesso" no módulo ganha CRUD completo automaticamente (para não perder capacidade de uma hora pra outra)?
3. Ok aplicar as checagens granulares em 2-3 pontos agora e o resto virar TODO, ou você quer eu propagar `can.delete/edit` em todas as telas nesta mesma entrega (aumenta bastante o tamanho)?