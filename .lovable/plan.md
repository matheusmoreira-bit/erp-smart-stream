## Objetivo

Hoje a mesma pessoa aparece e é tratada como várias identidades (`matheus.moreira`, `matheus.moreira@anagaming.com.br`, `matheus.moreira@cactusgaming.net`). Isso já causa duplicidade na tela de usuários e é a raiz dos problemas de permissão/visibilidade.

Novo modelo: **o usuário SAP é a chave**. Um usuário SAP tem **1 nome** e **N e-mails**.

Confirmação no banco: das ~90 linhas de `user_group_assignments`, a maioria é variação da mesma pessoa; só 2 casos (blenda.pinheiro.ext e larissa.manzalli) têm grupos diferentes entre variações — nesses, os grupos serão unidos (nada é perdido).

## Diretório canônico (backend)

Novas tabelas:

- `sap_user_directory` — `user_key` (chave canônica, ex. `matheusmoreira`), `sap_user_code` (código SAP oficial), `display_name` (nome único), `is_active`
- `sap_user_emails` — `user_key` + `email` (N e-mails por usuário, único por e-mail)

Nova função SQL `public.canonical_user_key(text)` (mesma regra já usada em `_shared/user-aliases.ts`): minúsculas, sem acento, sem domínio, sem sufixos `.ext/.adm`, sem separadores. Usada em todo lugar como fonte única da verdade.

Carga inicial: consolida `sap_cache` (usuários SAP), `idp_user_mapping`, `collaborator_profiles`/`user_profiles` e as variações já existentes em `user_group_assignments`.

## Deduplicação das tabelas de permissão

- `user_group_assignments`: converte `sap_email` para a chave canônica, unindo grupos das variações; passa a ter índice único por (chave, grupo) e trigger que canonicaliza qualquer gravação futura — não há mais como criar uma variação.
- Mesmo tratamento em `approver_cost_centers` e `approver_substitutes` (identidade de aprovador).
- Backup das linhas originais em tabela de auditoria antes da migração, para reversão.

## Frontend

- Novo helper `src/lib/user-identity.ts` com `canonicalUserKey()` (espelho da função SQL) e `useUserDirectory()` para buscar nome/e-mails.
- Tela de Usuários (`/usuarios/lista`): agrega por chave canônica — uma linha por pessoa, exibindo o **nome**, o **código SAP** e os e-mails vinculados como chips secundários. Some a duplicidade.
- Tela de Permissões e Grupos: seleciona e grava por usuário SAP (nome + código), nunca por e-mail solto.
- Aprovações, substitutos, centros de custo e filtros passam a comparar por chave canônica, substituindo as comparações ad-hoc por `split("@")[0]` espalhadas hoje em `Approvals.tsx`, `Expenses.tsx`, `useApproverSubstitutes.ts` e `approvalSegments.ts`.
- Exibição continua pelo nome (`displayUserName`), agora priorizando o `display_name` do diretório.

## Backend / Edge Functions

- `_shared/user-aliases.ts` passa a consultar o diretório (chave + e-mails) em vez de heurística por string, mantendo a normalização como fallback.
- `_shared/permission-groups.ts` resolve o grupo pela chave canônica.
- Funções de aprovação, notificação e provisão passam a usar o mesmo resolvedor.

## Detalhes técnicos

- Todas as novas tabelas com RLS: leitura para usuários autenticados, escrita apenas para admin (`has_role`) e `service_role`; GRANTs explícitos.
- A migração de dados é idempotente e registra tudo em `audit_log`.
- Nenhuma alteração de esquema destrutiva: colunas atuais permanecem, apenas passam a conter o valor canônico.

## Resultado

Uma pessoa = um usuário SAP = um nome = N e-mails. Permissão, alçada e visibilidade deixam de depender de qual e-mail o usuário digitou ou de qual domínio a empresa usa.
