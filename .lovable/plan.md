# Redesign do Mapa de Relações — Timeline Horizontal

Transformar o grafo atual (nós dispersos com ligações em várias direções) em uma **timeline horizontal por estágios**, mantendo toda a lógica de dados existente. Somente a camada de renderização muda.

## Escopo

Alterar **apenas** o componente de visualização:
- `src/components/RelationsMapFlow.tsx` — novo layout em colunas (será reescrito)
- `src/components/RelationsMap.tsx` — pequenos ajustes: passar `flowType`, legenda, handler do painel lateral

**Não alterar**: hooks (`useRelationsMapDerived`, etc.), edge functions, queries SAP/PagCorp, nem outros componentes.

## Layout

Canvas horizontal com React Flow (mantém pan/zoom/controles/minimap já existentes).

Colunas fixas (estágios), da esquerda para a direita:

**Fluxo de compras** (padrão, quando `flowType="compras"`):

```text
[Pedido de Compra] → [Aprovação] → [PC no SAP] → [NF de Entrada] → [Contas a Pagar]
```

**Fluxo PagCorp** (`flowType="pagcorp"` — detectado quando o expense vem de despesa PagCorp; por ora expõe prop opcional, default `compras`):

```text
[Despesa PagCorp] → [PC no SAP] → [NF de Entrada] → [Baixa Contas a Pagar]
```

Cada coluna:
- Cabeçalho fixo no topo com ícone + nome do estágio + contador de nós
- Nós empilhados verticalmente quando há ramificação (1-N)
- Largura fixa (~260px), altura dinâmica
- Fundo levemente diferenciado (faixa vertical translúcida) para separar as colunas

Edges:
- `type: "smoothstep"` com curva horizontal (saem sempre da direita → entram na esquerda)
- Ligações 1-N formam leque a partir do mesmo `sourceHandle`
- Ligações pendentes/não confirmadas: `strokeDasharray` (tracejado)
- Cor da edge segue o tom do nó de origem

## Card (nó) — conteúdo compacto

Cada card mostra:
- Ícone + tipo (Pedido, PC SAP, NF, Contas a Pagar, Aprovação)
- Número/identificador (`SAP #7350`, `NF 10147/9`, `AP Doc #123`)
- Valor formatado
- Badge de status (finalizado, em aberto, pendente, rejeitado)
- Quem lançou (nome curto)
- Data de criação/lançamento
- Indicador de anexos (`📎 N`) — só quando houver

Cores por tipo (mantém paleta existente):
- Pedido/PC SAP → âmbar (`cactus-amber`)
- Aprovação → azul (`primary`)
- NF Entrada → verde (`cactus-green`)
- Contas a Pagar → violeta

Estados visuais:
- `current` → borda mais forte + anel pulsante sutil
- `done` → check no canto
- `rejected` → borda destrutiva + X
- `pending` → opacidade reduzida

## Painel de detalhes lateral

Ao clicar num card, abrir **Sheet lateral direito** (não modal center), mostrando:
- Todos os campos do card, expandidos
- Lista de anexos (nome, tipo, link — reusa `AttachmentViewer`)
- Relação: "Gerado a partir de: X" / "Gerou: Y, Z"
- Histórico de mudanças de status (quando disponível — reusa dados já carregados: `log`, `sapHistory`)

O `StageDetailDialog` atual em `RelationsMap.tsx` é adaptado para receber um `nodeId` específico em vez de apenas o `stageKey`, permitindo mostrar detalhes de um nó específico (ex.: uma NF entre várias).

## Legenda

Barra fina fixa no topo do canvas (abaixo do toggle "Enriquecer") com chips coloridos: `● Pedido/PC ● Aprovação ● NF ● Contas a Pagar`.

## Estrutura de dados interna

Novo builder `buildTimelineGraph()` dentro de `RelationsMapFlow.tsx`, montando:

```ts
type StageColumn = {
  key: "pedido" | "aprovacao" | "pc_sap" | "nf_entrada" | "contas_pagar" | "despesa_pagcorp";
  label: string;
  x: number; // posição X fixa da coluna
  nodes: TimelineNode[];
};
```

Depois converte para `Node[]` + `Edge[]` do React Flow, calculando Y de cada nó (centraliza verticalmente dentro da coluna, com espaçamento fixo).

Edges construídas explicitamente a partir das relações já derivadas:
- Pedido → Aprovação (1-N nos aprovadores)
- Aprovação (último aprovador) → PC SAP
- PC SAP → NFs (`nfLinks`)
- Cada NF → seus `ap_links`
- Contas a Pagar órfãs → linha direta do PC SAP

## Responsividade

- Canvas em `w-full h-[65vh]` (mantido)
- Em telas estreitas, `fitView` faz zoom-out; usuário pode dar pan/zoom
- Colunas mantêm largura fixa → scroll horizontal natural do canvas

## Detalhes técnicos

- Continua usando `@xyflow/react` (já instalado)
- Novos tipos de nó: `stageHeader` (cabeçalho da coluna), `docCard` (nó unificado com variantes de tom)
- `nodesDraggable={false}` nos cabeçalhos, `true` nos cards
- Handles somente `left` (target) e `right` (source) — remove os `top`/`bottom` do RootNode
- Legenda como componente HTML sobreposto ao canvas (position absolute)

## Não escopo (não fazer)

- Alterar hooks de dados
- Alterar edge functions
- Alterar outras telas
- Detectar automaticamente `flowType` — receber via prop com default `"compras"`; a detecção PagCorp fica para etapa futura
