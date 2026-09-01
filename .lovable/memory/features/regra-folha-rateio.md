---
name: Regra Folha por tipo de rateio
description: Documentos com "Tipo de rateio = Folha" devem ir para Ketlhenn Monteiro como aprovadora única, independentemente do CC/item.
type: feature
---
Sempre que o documento tiver `rateio_type = folha`, a cadeia de aprovação é
única: **Ketlhenn Monteiro** (nível 1), ignorando a matriz por centro de custo.

Implementado como regra "Folha (tipo de rateio)" (prioridade 999, critério
`rateio_type equal folha`) em SBO_INSTITUTO_ANA, SBO_ANAGAMING e SBO_CACTUS.
Replicar nas demais empresas quando começarem a usar o tipo de rateio Folha.
