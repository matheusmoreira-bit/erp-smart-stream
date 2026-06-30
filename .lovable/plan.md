## Objetivo
Unificar permissões: um usuário tem os mesmos módulos em TODAS as empresas. Acesso definido por grupo, nunca nominal por empresa.

## Mudanças

### 1. Banco de dados (migration)
- `user_group_assignments`: tornar `company_db` obsoleto.
  - Consolidar registros existentes: para cada `(sap_email, group_id)` distinto, manter um único registro com `company_db = NULL` (união dos grupos atuais do usuário em qualquer empresa).
  - Remover duplicatas, ajustar unique constraint para `(sap_email, group_id)` e tornar `company_db` sempre `NULL` (ou dropar a coluna — manter `NULL` é mais seguro contra rollback).
- `permission_groups`: remover/ignorar colunas `erp_type` e `company_db` (grupos já são globais por convenção; garantir `NULL` em todas as linhas).
- Atualizar políticas RLS se referenciarem `company_db`.

### 2. Hook `usePermissions.ts`
- `useUserAssignments`: ignorar parâmetro `companyDb`, sempre listar global.
- `assign()`: gravar sempre com `company_db = null`, `onConflict: "sap_email,group_id"`.
- `useModuleAccess`: remover filtro por `companyDB`; buscar somente assignments globais do usuário.

### 3. UI `PermissionManager.tsx`
- Remover o seletor/coluna "Empresa" na aba de atribuições de usuários.
- Mostrar lista única de usuários × grupos, válida para todas as empresas.
- Manter gestão de grupos como já é (globais).

### 4. Memória do projeto
- Atualizar `mem://features/permissions.md`: assignments são globais; remover menção a "per company_db".

## Detalhes técnicos
- `OMIE open modules` continua valendo (early-return em `useModuleAccess`).
- Admin de backoffice e SAP superuser continuam com todos os módulos.
- Default (sem grupo) continua = `expenses`.
- A coluna `company_db` permanece na tabela por compatibilidade, sempre `NULL`. Pode ser removida em migration futura após verificação.

## Confirmação necessária
1. Posso **consolidar automaticamente** os assignments atuais (união dos grupos do usuário entre empresas vira o conjunto global) ou prefere **zerar tudo** e reatribuir manualmente?
2. Posso **dropar a coluna `company_db`** de `user_group_assignments` agora, ou prefere mantê-la como `NULL` por segurança?