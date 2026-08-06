---
name: Segmentos de gestão (ANA Gaming / Lótus / CSC)
description: Campo de segmento por usuário em sap_user_directory.management_segment com 3 grupos; CSC vê todos os projetos
type: feature
---

- Coluna `sap_user_directory.management_segment` ('gestao_1' | 'gestao_2' | 'csc'), default `gestao_1`.
- Rótulos exibidos: `gestao_1` = **ANA Gaming**, `gestao_2` = **Lótus**, `csc` = **CSC**.
- Hook `src/hooks/useManagementSegments.ts` (segmentOf / setSegment por chave canônica).
- Editável na tela de Usuários (`/usuarios/lista`), linha "Gestão".
- Recorte de projetos (`src/lib/management-segment-projects.ts`, capacidade `projects_scope_by_segment`):
  - ANA Gaming → `7K`
  - Lótus → `VERA`, `CASSINO`
  - CSC → sem recorte (vê todos os projetos)
- Vale apenas nas bases ANA Gaming (`SBO_ANAGAMING`, `SBO_TESTE_20260318_ANAGAMING`).
- Carga inicial Lótus (04/08/2026): douglassilva, felipeescudeiro, gracielafernandes, gustavocoelho, samuelramos, vicenteneto.
