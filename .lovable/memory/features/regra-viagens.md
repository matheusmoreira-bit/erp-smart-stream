---
name: Regra de aprovação "Viagens" (tipo de rateio)
description: Documentos com rateio_type=viagens têm aprovador único (Daniela Camargos) em Open Gaming, ANA Gaming e Cactus Tecnologia.
type: feature
---
- Regra `Viagens`, critério `rateio_type = viagens`, prioridade 9999, doc_type `purchase`, nível único = **Daniela Camargos**.
- Existe em: `open_gaming_sa`, `SBO_ANAGAMING` (daniela.camargos@anagaming.com.br) e `SBO_CACTUS` (daniela.camargos@cactusgaming.net).
- Sem essa regra, notas de viagem (ex.: VOLL S.A.) caem nas alçadas por CC/projeto e, como são rateadas entre dezenas de segmentos, a cadeia mesclada gera dezenas de aprovadores.
- Ao criar em nova base: replicar a regra e reprocessar pendentes via `expense-reassign-approver` (`only_unmatched: false`).
