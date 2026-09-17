---
name: Aprovação unânime no nível
description: Níveis podem exigir aprovação de TODOS os aprovadores (require_all); Cactus Tecnologia tem Robson Luiz como 2º aprovador do nível 1 em todas as regras ativas.
type: feature
---
- `approval_rule_levels.require_all` (boolean): quando true, TODAS as linhas do mesmo `level_order` precisam aprovar para o documento avançar. Quando false, vale o comportamento antigo (o primeiro que decidir encerra o nível).
- Em nível unânime, todos os aprovadores do nível são alvos válidos mesmo com `current_approver` gravado; `current_approver` aponta para o próximo pendente. Segundo clique do mesmo aprovador responde "sua aprovação já está registrada" (não duplica log).
- SBO_CACTUS (Cactus Tecnologia): todas as regras ativas sem auto_approve têm Robson Luiz (robson.luiz@cactusgaming.net) como aprovador paralelo no nível 1, e o nível 1 é unânime (os dois precisam aprovar).
- UI: tela de Regras de Aprovação tem o switch "Todos devem aprovar" por nível com 2+ aprovadores; badge mostra "Paralelo — todos aprovam" ou "Paralelo — 1º decide".
