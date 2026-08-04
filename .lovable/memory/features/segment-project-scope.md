---
name: Projetos por segmento de gestão
description: Capacidade projects_scope_by_segment limita projetos por Gestão 1 (ANA GAMING, 7K) e Gestão 2 (VERA, CASSINO) nas bases ANA Gaming; ligada no grupo Usuário
type: feature
---

- Capacidade de grupo `projects_scope_by_segment` (catálogo em `src/lib/permission-capabilities.ts`).
- Mapa em `src/lib/management-segment-projects.ts`:
  - Gestão 1 → `ANA GAMING`, `7K`
  - Gestão 2 → `VERA`, `CASSINO`
- Vale apenas nas bases ANA Gaming (`SBO_ANAGAMING`, `SBO_TESTE_20260318_ANAGAMING`); demais empresas sem recorte.
- Admins/super-usuários não são travados. Se a base não tiver os projetos mapeados, a lista completa é mantida.
- Ligada hoje no grupo **Usuário**.
