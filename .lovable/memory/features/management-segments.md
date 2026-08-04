---
name: Segmentação Gestão 1 / Gestão 2
description: Campo opcional de gestão por usuário (Gestão 1 padrão, Gestão 2 para lista da planilha de transição), em sap_user_directory.management_segment
type: feature
---

- Coluna `sap_user_directory.management_segment` ('gestao_1' | 'gestao_2'), default `gestao_1`.
- Hook `src/hooks/useManagementSegments.ts` (segmentOf / setSegment por chave canônica).
- Editável na tela de Usuários (`/usuarios/lista`), linha "Gestão".
- Carga inicial (04/08/2026, planilha de transição): usuários existentes marcados como Gestão 2 —
  douglassilva, felipeescudeiro, gracielafernandes, gustavocoelho, samuelramos, vicenteneto.
  Colaboradores da planilha sem usuário no sistema foram ignorados.
