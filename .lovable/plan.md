## Objetivo

Criar uma ferramenta de produtividade dentro do módulo de Usuários que vá além de login/sessão e mostre, por **departamento SAP** (OUDP), o quanto cada usuário entrega: documentos criados por tipo, edições/cancelamentos (retrabalho) e valor financeiro movimentado em R$.

## Onde mora

- Nova página dedicada **`/users/productivity`** (`src/pages/UserProductivity.tsx`).
- Card de acesso no menu de Users e link na barra da página `UserActivity` (atalho cruzado entre "Atividade" e "Produtividade").
- Reaproveita guarda de permissão (`useModuleAccess`) com novo `module_key = "users_productivity"`.

## Fonte dos dados (recomendação)

Combinar **documentos atuais + histórico de alterações**, exposto via duas novas HANA Views (a serem criadas no backend HANA junto às views já existentes como `VW_TODAS_APROVACOES`):

1. **`VW_USER_PRODUCTIVITY`** — uma linha por (UserCode, DocType, Periodo) com:
   - `UserCode`, `UserName`, `Department` (de OUDP via OHEM/OUSR)
   - `DocType` (PC=OPOR, PV=ORDR, NFE=OPCH, Pagto=OVPM, NF Saída=OINV, etc.)
   - `DocsCriados` (count onde `UserSign = UserCode`)
   - `ValorTotalBRL` (sum DocTotal convertido)
   - `DocsCancelados` (CANCELED='Y' ou estornados)
   - `Periodo` (YYYY-MM)

2. **`VW_USER_DOC_EDITS`** — agregação sobre ADOC/AOPR:
   - `UserCode`, `Department`, `DocType`, `Periodo`
   - `EdicoesFeitas` (versões geradas em ADOC por usuário)
   - `DocsEditadosUnicos` (count distinct DocEntry)

Enquanto as views não existirem no HANA, a página renderiza estado vazio amigável ("aguardando views HANA `VW_USER_PRODUCTIVITY` e `VW_USER_DOC_EDITS`") sem quebrar — mesmo padrão usado por `useSapDashboard`.

## Layout da página

```text
┌─────────────────────────────────────────────────────────────┐
│ Produtividade de Usuários            [Período ▾] [↻]        │
├─────────────────────────────────────────────────────────────┤
│ KPIs:  Total docs | Valor R$ movimentado | Taxa retrabalho  │
│        Top departamento | Usuário mais produtivo            │
├─────────────────────────────────────────────────────────────┤
│ [Tabs]  Por Departamento │ Por Usuário │ Por Tipo de Doc    │
├─────────────────────────────────────────────────────────────┤
│  • Tabela agrupada (Departamento → Usuário expansível)      │
│  • Colunas: Docs criados | Valor R$ | Edições | Cancelados  │
│    | Retrabalho %  | barra comparativa                      │
├─────────────────────────────────────────────────────────────┤
│ Gráficos:                                                   │
│  - Bar chart: docs por departamento (empilhado por tipo)    │
│  - Bar chart: valor R$ movimentado por departamento         │
│  - Ranking cards: Top 10 criadores / Top 10 retrabalho      │
└─────────────────────────────────────────────────────────────┘
```

Filtros: período (último mês / trimestre / customizado), departamento, tipo de documento. Export CSV.

## Componentes a criar

- `src/pages/UserProductivity.tsx` — página com filtros, KPIs e tabs.
- `src/hooks/useUserProductivity.ts` — busca `VW_USER_PRODUCTIVITY` + `VW_USER_DOC_EDITS` em paralelo, faz merge por (UserCode, DocType, Periodo) e agrega por departamento. Trata `hanaDisabled` retornando vazio.
- `src/components/ProductivityKpis.tsx` — 5 cards de KPI.
- `src/components/ProductivityByDepartment.tsx` — tabela expansível (Departamento → Usuários).
- `src/components/ProductivityByUser.tsx` — ranking ordenável.
- `src/components/ProductivityByDocType.tsx` — agregação por tipo.
- `src/components/ProductivityCharts.tsx` — Recharts bar/stacked usando o design system existente.

## Métricas calculadas no cliente

- **Taxa de retrabalho** = `(EdicoesFeitas + DocsCancelados) / DocsCriados`
- **Ticket médio** = `ValorTotalBRL / DocsCriados`
- **Score de produtividade** (heurística): `DocsCriados * 1 + ValorTotalBRL/10000 - EdicoesFeitas*0.3 - DocsCancelados*1` (ajustável depois)

## Integração com o restante

- Adicionar entrada no `MainMenu` dentro do agrupamento já existente de Usuários, seguindo o estilo minimal/icon (memória `users-screen-actions`).
- Adicionar `module_key = "users_productivity"` na lista de módulos do `PermissionManager` (UI de permissões), liberando para os grupos que devem ver.
- Rota nova em `App.tsx` protegida por `useModuleAccess("users_productivity")`.

## Detalhes técnicos

- Consumo via `sapQueryView(session, "VW_USER_PRODUCTIVITY", { from: "YYYY-MM-DD", to: "YYYY-MM-DD" })`. O proxy `sap-b1-proxy` já encaminha `params` ao endpoint HANA, então nenhuma mudança no edge function é necessária se a view aceitar parâmetros via query string.
- Cache de cliente já tratado em `sapQueryView` (TTL existente). Botão "Atualizar" força `useCache=false`.
- Conversão de moeda: confiar em `DocTotalSys` (sistema, BRL) quando disponível; senão `DocTotal`.
- Companies OMIE: a página fica oculta para empresas com `erp_type = "omie"` (mesmo padrão de `UserActivity`).

## O que NÃO entra neste escopo

- Criação das HANA Views em si (depende do time de banco / backend HANA). Vamos deixar a UI pronta consumindo os nomes `VW_USER_PRODUCTIVITY` e `VW_USER_DOC_EDITS` e documentar o contrato esperado num `README` curto dentro de `src/pages/UserProductivity.tsx` (comentário no topo).
- Score ponderado configurável por admin (fica para v2).
- Integração com aprovações dadas — já existe em outra tela; vamos só linkar.
