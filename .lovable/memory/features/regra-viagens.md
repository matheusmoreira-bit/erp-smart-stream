---
name: Regras globais Viagens / Folha / Impostos
description: Regras de alçada por tipo de rateio e grupo de item replicadas em todas as empresas, com aprovador único para evitar cadeias longas em rateios
type: feature
---

Presentes em TODAS as empresas (company_db):

- **Viagens** — `rateio_type = viagens`, doc_type `purchase`, prioridade 9999.
  Aprovadora única: Daniela Camargos (@cactusgaming.net nas bases Cactus, @anagaming.com.br nas demais).
- **Folha (grupo do item)** — `item_groups like %folha%` e **Folha (prefixo FOL)** — `item.code like %fol%`,
  prioridade 9999. Aprovadora única: Ketlhenn Monteiro.
- **ALL - Impostos** (`item_groups like %impostos%` OU `item.code like %imp%` OU `rateio_type = imposto`),
  prioridade 10000, em 3 faixas:
  - até 10k → Fernanda Faria
  - 10k a 300k → Fernanda Faria > Marco Ferreira
  - acima de 300k → Fernanda Faria > Marco Ferreira > Juliana Gavineli
  (ANA Gaming mantém faixas próprias com variações por projeto.)

Objetivo: pedidos rateados entre vários CCs/segmentos não geram cadeia de aprovadores
gigante — cada segmento cai na regra temática com aprovador único em vez da alçada por CC.
