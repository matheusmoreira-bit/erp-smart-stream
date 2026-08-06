---
name: Segmentos de gestão (ANA Gaming / Lótus / CSC / BET.BET / DONALD)
description: Campo de segmento por usuário em sap_user_directory.management_segment, com opções por empresa; CSC vê todos os projetos
type: feature
---

- Coluna `sap_user_directory.management_segment` ('gestao_1' | 'gestao_2' | 'csc' | 'betbet' | 'donald'), default `gestao_1`.
- Rótulos: `gestao_1` = **ANA Gaming**, `gestao_2` = **Lótus**, `csc` = **CSC**, `betbet` = **BET.BET**, `donald` = **DONALD**.
- Opções por base (`segmentsForCompany`, `src/hooks/useManagementSegments.ts`):
  - ANA Gaming e demais: ANA Gaming / Lótus / CSC
  - Open Gaming (`open_gaming_sa`, `SBO_OPENGAMING`): CSC / BET.BET / DONALD
- Editável na tela de Usuários (`/usuarios/lista`), linha "Gestão".
- Recorte de projetos (`src/lib/management-segment-projects.ts`, capacidade `projects_scope_by_segment`):
  - ANA Gaming → `7K`; Lótus → `VERA`, `CASSINO`; BET.BET → `BET.BET`; DONALD → `DONALD`; CSC → todos.
- Bases com recorte: `SBO_ANAGAMING`, `SBO_TESTE_20260318_ANAGAMING`, `open_gaming_sa`, `SBO_OPENGAMING`.
- Segmento fora da lista da base não aplica recorte (evita travar por default).
- Carga inicial Lótus (04/08/2026): douglassilva, felipeescudeiro, gracielafernandes, gustavocoelho, samuelramos, vicenteneto.
