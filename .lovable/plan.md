
## Objetivo

Estender o módulo de auditoria existente com uma análise **Cruzamento Fiscal × Pagamentos** que:

1. compara notas capturadas pelo MasterTax com **contas a pagar baixadas no ERP** da empresa;
2. gera três cenários — **pago sem nota**, **nota sem pagamento**, **conciliado**;
3. funciona para qualquer ERP através de **adapters**, com Omie implementado de ponta a ponta e SAP B1 com a estrutura pronta.

Não altera o fluxo já existente que casa **nota × Pedido de Compra** (usado para preparar o lançamento automático de NF de Entrada). São propósitos diferentes e ficam separados no dado final.

## Arquitetura

```text
MasterTax (notas)          ERP (pagamentos)
      │                          │
      │                    ┌─────┴──────┐
      │                    │  Adapter   │  (Omie, SAP B1, futuros)
      │                    │  por ERP   │
      │                    └─────┬──────┘
      │                          │  ContaPagaERP[]  (modelo normalizado)
      ▼                          ▼
        Motor de Cruzamento (agnóstico)
                 │
                 ▼
    auditoria_cruzamento_fiscal (3 cenários)
                 │
                 ▼
        UI dentro do módulo de Auditoria
```

O motor de cruzamento **não conhece o ERP**: recebe duas listas já normalizadas.

### Contrato do adapter

`getContasPagas(periodoInicio, periodoFim, companyDb) → ContaPagaERP[]`

`ContaPagaERP` = `{ erp_origem, empresa_id, id_externo, cnpj_fornecedor, razao_social_fornecedor, valor_pago, data_baixa, forma_pagamento?, referencia?, link_origem? }`.

Registro central em `supabase/functions/_shared/erp-adapters/index.ts` com um mapa `{ omie, sap_b1 }` — novo ERP = novo arquivo + nova entrada no mapa.

## Passos de implementação

### 1. Reaproveitamento antes de escrever novo código

- Ler `mastertax-pull` e `nf-entrada-rematch` para extrair a **normalização de CNPJ** e as **tolerâncias já calibradas** (valor/data). Publicar como helpers em `supabase/functions/_shared/fiscal-match.ts` (`normalizeCnpj`, `matchWithinTolerance`, `sameCnpjRoot`).
- Para o adapter Omie: reusar a camada já existente em `src/lib/omie-client.ts` e a edge `omie-proxy` — não abrir uma nova rota de API.
- Para o adapter SAP B1: reusar `supabase/functions/sap-b1-proxy` e a montagem de sessão do Service Layer usada no `nf-entrada-rematch` (Login/Logout, cookie B1SESSION). **Diferente do fluxo de PC**, o adapter consulta `Invoices` de fornecedor com pagamentos aplicados (via `IncomingPayments`/`VendorPayments` conforme disponibilidade), retornando **baixa financeira**, não PO. Deixar a implementação parcial + TODO documentado se não for possível fechar nesta entrega.

### 2. Schema (migração única)

Tabela `auditoria_cruzamento_fiscal` com os campos do prompt + índices por `(empresa_id, cenario, criado_em)` e `(cnpj_fornecedor, nota_data_emissao)`. Unique parcial `(nota_mastertax_id, conta_paga_id_externo)` para idempotência do reprocessamento.

Tabela `auditoria_cruzamento_config` (por empresa, opcional):
- `tolerancia_valor_abs`, `tolerancia_valor_pct`, `janela_dias`, `usar_raiz_cnpj_fallback`.
Fallback global via constantes se a empresa não tiver config.

RLS: `admin` OR `can_access_audit_console(empresa.company_db)` para SELECT; escrita só via edge function (service_role). GRANTs conforme padrão do projeto.

### 3. Motor de cruzamento

Edge function `audit-cross-fiscal-run`:
1. Recebe `{ empresa_id, periodo_inicio, periodo_fim }`.
2. Lê `companies` para descobrir `erp_origem` da empresa.
3. Busca notas MasterTax do período (`nf_entrada_imports` + storage), filtradas pelo CNPJ da empresa.
4. Chama `adapter.getContasPagas(...)` via mapa de adapters.
5. Para cada nota: procura candidatos por CNPJ (com fallback opcional de raiz), valor (tolerância) e data (janela). 0 → `nota_sem_pagamento`, 1 → `conciliado/automatico`, 2+ → `ambiguo`.
6. Contas não consumidas → `pago_sem_nota`.
7. Upsert idempotente em `auditoria_cruzamento_fiscal`, gravando `diferenca_valor`, `diferenca_dias`, `erp_origem`, `link_origem`.

Job diário via `pg_cron` chamando a função por empresa ativa.

### 4. UI

Nova rota `/auditoria/cruzamento-fiscal` dentro do hub de auditoria (`AuditHub`):
- Filtros: período, empresa, ERP de origem, cenário.
- 3 cards: contador + soma R$ por cenário.
- 3 abas/tabelas (uma por cenário) com colunas: fornecedor, CNPJ, valor nota, valor pago, diferença, dias, ERP (badge), ações.
- Badge de ERP (`Omie`, `SAP B1`) ao lado de cada linha; link externo quando `link_origem` existir.
- Casos `ambiguo`: painel de revisão manual (escolher qual conta paga é a certa → passa a `confirmado_manual`).
- Botão "Reprocessar período" (chama a edge function).
- Export CSV/Excel com coluna `ERP`.

### 5. Configuração

Aba dentro da mesma tela: editar tolerâncias e janela por empresa (grava em `auditoria_cruzamento_config`).

Mapeamento **empresa → ERP** já existe no cadastro `companies` (campo de tipo de ERP). Se faltar campo explícito, adicionar `erp_type` em `companies` na mesma migração.

## Fora do escopo

- Não altera a integração de captura MasterTax.
- Não altera o fluxo nota × Pedido de Compra (rematch SAP).
- SAP B1 pode entrar como adapter parcial + TODOs se o mapeamento de pagamentos precisar de refinamento com base em dados reais — nesse caso, a UI já mostra a empresa mas rotula "aguardando pagamentos SAP" e o adapter Omie continua funcional.

## Entregável

- 1 migração (tabelas + RLS + GRANTs + índices).
- Helpers `_shared/fiscal-match.ts` e `_shared/erp-adapters/{index,omie,sap_b1}.ts`.
- Edge function `audit-cross-fiscal-run` + cron diária.
- Página React + hook `useAuditCrossFiscal`.
- Item de menu dentro do AuditHub.

## Detalhes técnicos

- Idempotência: o upsert usa `(empresa_id, nota_mastertax_id, conta_paga_id_externo)` — reprocessar o mesmo período atualiza status, nunca duplica.
- `link_origem`: Omie = URL do módulo Contas a Pagar com o `nCodTitulo`; SAP B1 = deep link do Web Client quando conhecido, senão vazio.
- Segurança: adapter só recebe `companyDb` já validado; nunca aceita SQL do cliente; toda credencial vem de `system_credentials`.
- Testes unitários do motor com listas mockadas dos dois lados (validação de tolerâncias e ambiguidade).
