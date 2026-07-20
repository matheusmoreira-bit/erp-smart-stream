# Plano — Evolução de Permissões e Segurança do ERP Flow

## Objetivo
Sair do modelo atual (um grupo global por usuário, controle só de visibilidade de módulo) para um modelo **auditável, granular e ancorado em identidade JumpCloud + grupos SAP**, sem quebrar o funcionamento atual durante a transição.

## Princípios (decisões já tomadas)
- **Identidade:** JumpCloud é a fonte única de "quem é o usuário". Login local só sobrevive para admins de backoffice.
- **Permissão por empresa:** cada empresa (company_db) define, via grupos SAP, o que o usuário pode fazer naquela base.
- **Escopo do papel do ERP Flow:** continua **global** (um grupo/perfil por usuário vale em todas as empresas), mas o *conjunto de ações permitidas* é derivado do cruzamento com os grupos SAP daquela empresa.
- **Granularidade:** `módulo + ação` (ver, criar, editar, aprovar, excluir, integrar). Sem filtro por CC/projeto nesta fase.
- **Provisionamento:** manual sempre. Nenhum usuário JC entra automaticamente — backoffice precisa vincular.

## Arquitetura alvo

```text
        JumpCloud (identidade)
                │  (SSO/OIDC login, e-mail canônico)
                ▼
        idp_user_mapping ─────── user_group_assignments (grupo GLOBAL ERP Flow)
                │                            │
                │                            └─► permission_group_modules
                │                                (módulo + ação: ver/criar/editar/aprovar/excluir/integrar)
                ▼
        sap_group_mapping   (POR EMPRESA: SAP group ↔ módulos+ações liberadas)
                │
                ▼
        Runtime authz:
        pode(user, empresa, módulo, ação) =
            grupo_ERPFlow_permite(módulo, ação)
          ∧ algum_grupo_SAP_do_user_na_empresa_permite(módulo, ação)
          ∨ user_é_admin_backoffice
```

## Entregas

### 1. Modelo de permissão com ação
- Nova tabela `permission_actions` (enum-like): `view`, `create`, `edit`, `approve`, `delete`, `integrate`, `export`.
- Estender `permission_group_modules` com coluna `action` (default `view`) e chave composta `(group_id, module_key, action)`.
- Migrar registros atuais como `action = 'view'` (comportamento idêntico ao de hoje).
- Helper SQL `has_module_action(_user_id, _company_db, _module, _action) returns boolean` (security definer) usado em RLS e no cliente via RPC.

### 2. Mapeamento SAP → ERP Flow por empresa
- Nova tabela `sap_group_mapping (company_db, sap_group_code, sap_group_name, module_key, action, can boolean)`.
- Cadastro pelo Backoffice: para cada empresa, lista os grupos do SAP (lidos do `sap_cache.Groups`) e marca em uma matriz `módulo × ação` o que aquele grupo libera.
- Sincronismo periódico dos grupos SAP em `sap_groups_cache` (por empresa) para o Backoffice montar a UI.

### 3. Amarração JumpCloud
- `idp_user_mapping` (já existe) vira **obrigatório** para novos usuários: sem vínculo JC = sem login (exceto conta backoffice local).
- Migração ativa dos usuários existentes: script no Backoffice para revisar/vincular todos antes de ligar o hard-check.
- Login OMIE via Google continua funcionando, mas será redirecionado para o mesmo `idp_user_mapping` (provider = google), unificando o cadastro.
- Backoffice ganha aba "Usuários JumpCloud não vinculados" para provisionamento manual explícito.

### 4. Runtime + hooks
- `useModuleAccess(module, action?)` substitui o hook atual; retorna `{ canView, canCreate, canEdit, canApprove, canDelete, canIntegrate }`.
- Componentes de página passam a esconder/desabilitar botões via `canX` em vez de só rota.
- RLS das tabelas sensíveis (`expenses`, `expense_items`, `advance_payments`, `baixas_recebimento`, `sales…`) reescrita para chamar `has_module_action`.

### 5. Backoffice — nova tela "Permissões"
- Aba 1 · **Grupos globais ERP Flow**: matriz módulo × ação por grupo (edita `permission_group_modules`).
- Aba 2 · **Mapeamento SAP por empresa**: seletor de empresa → tabela `grupo SAP × (módulo × ação)`.
- Aba 3 · **Usuários**: mostra JC vinculado, grupo global ERP Flow, e o "efetivo" calculado por empresa (view read-only para debug/auditoria).
- Aba 4 · **Auditoria**: log de toda mudança em grupos, mapeamentos e vínculos (já existe `audit_log`, só formatar).

### 6. Segurança & robustez
- Todas as tabelas novas com RLS estrita (`has_role(auth.uid(),'admin')` para escrita; leitura só para o próprio usuário quando aplicável) + GRANTs corretos.
- Índices em `(company_db, module_key, action)` e `(sap_email, company_db)`.
- Feature flag `permissions_v2_enforced` (default off) para virar por empresa/gradual; enquanto off, o novo motor só *loga* o que teria negado.
- Testes de integração cobrindo: usuário sem JC, usuário com JC mas sem grupo SAP na empresa X, admin backoffice, super-admin SAP, empresa OMIE (mantém regra atual de módulos abertos).

## Roll-out sugerido (4 fases, sem downtime)

1. **Fundação (schema + migração idempotente):** cria tabelas, ação `view` para tudo que já existe. Nada muda na UX. ✅
2. **Backoffice:** libera as 4 abas de gestão. Time começa a preencher grupos SAP × módulo × ação por empresa. ✅
3. **Shadow mode (foundation):** identidade JC/local obrigatória (feature flag), gates prontos no login. ✅
4. **Shadow mode runtime + enforcement gradual:** motor v2 no cliente (`checkModuleAction`), tabela `permission_shadow_log`, toggle `enforce` por empresa em `permissions_enforcement_scope`, tela de admin (Enforcement v2). ✅ (infra)
   - **Próximo:** aplicar `checkModuleAction` nos botões críticos (aprovação, integração SAP, cancelar), ligar o `permissions_v2` global em shadow para começar a coleta, reescrever RLS de `expenses`/`expense_items`/`baixas_recebimento` para consumir `has_module_action` — feito por módulo, com validação.

## Fora do escopo desta fase
- Filtros de linha por CC/projeto/filial (fica em backlog para eventual v3).
- Provisionamento automático a partir de grupos JC (podemos revisitar depois que o cadastro estiver estável).
- MFA/step-up per-ação sensível (candidato natural para a fase seguinte).

## Detalhes técnicos (para desenvolvedores)
- Migrações Postgres com `GRANT` + `ENABLE RLS` + `CREATE POLICY` na ordem canônica.
- Função `has_module_action` marcada `SECURITY DEFINER`, `SET search_path = public`, evitando recursão RLS.
- Cliente lê permissões via RPC única `get_effective_permissions(company_db)` cacheada por sessão + invalidada por Realtime na tabela `permission_group_modules` e `sap_group_mapping` (padrão que já usamos hoje).
- OMIE mantém bypass explícito documentado (memória `omie-open-modules`).
- Nenhuma quebra no fluxo atual até a fase 4; rollback = desligar a flag.
