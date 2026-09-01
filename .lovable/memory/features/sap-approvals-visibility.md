---
name: Visibilidade das aprovações vindas do SAP
description: A lista de pendências do SAP (VW_APROVACOES_DETALHADAS) é filtrada no servidor: cada usuário só vê o que aprova ou solicitou
type: feature
---

- A edge function `sap-approvals-hana` deixou de devolver todas as pendências da empresa.
- Filtro server-side por identidade do caller (aliases de e-mail/UserCode): linha só é
  retornada quando ele é o aprovador (`Aprovador`/`Email do aprovador`) ou o solicitante.
- Somente grupos com `expenses_view_all`/`approvals_view_all` recebem a lista completa.
- Caller não identificado → 401 (fail-closed).
- Motivo: diretor recebia documentos de outras áreas na fila (confidencialidade).
