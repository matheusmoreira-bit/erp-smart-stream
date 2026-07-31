---
name: Variação cambial nas baixas PagCorp
description: Diferenças pequenas entre baixa aplicada e valor esperado em moeda estrangeira são variação cambial e não devem ser canceladas.
type: feature
---
Nas baixas automáticas do PagCorp (pagcorp-settlement-audit / pagcorp-settlement-repair):

- Diferença em documento de moeda estrangeira até **3% do valor esperado** (limitada a **R$ 250**) é classificada como `fx_variation` — variação de PTAX entre a data da compra e a data da baixa, absorvida pelo ERP como variação/juros.
- `fx_variation` **nunca** é cancelada/refeita pelo reparo (só se o chamador enviar `includeFxVariation: true`); o parâmetro `fxTolerancePct` ajusta o limite.
- Divergências acima disso continuam sendo erro de lançamento (ex.: baixa do saldo inteiro da NF consolidada em vez da fatia do PC) e entram na lista de cancelamento.
