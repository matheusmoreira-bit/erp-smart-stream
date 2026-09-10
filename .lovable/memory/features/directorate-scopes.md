---
name: Escopos de visibilidade por diretoria
description: Duas permissões combináveis de visibilidade por diretoria (por centro de custo do documento e por autor do documento)
type: feature
---
Duas capacidades independentes e combináveis em `permission_group_modules`:

- `documents_view_directorate` — recorte pelo **centro de custo do documento** (CC de 2º nível do IdP: 1.6.1.2 → 1.6.%).
- `documents_view_team_directorate` — recorte pelo **autor do documento**: gestor vê tudo lançado por colegas da mesma diretoria, em qualquer CC. Usa a função `get_my_directorate_peers()` (SECURITY DEFINER, só authenticated) que devolve e-mails/user_code de quem tem o mesmo ramo de CC no IdP.

Ambas são desconsideradas quando o usuário já tem visão total (admin, `expenses_view_all`, `approvals_view_all`). Sem CC no IdP, o usuário vê só os próprios documentos. Aplicadas em `useDirectorateScope` (Compras e Aprovações).
