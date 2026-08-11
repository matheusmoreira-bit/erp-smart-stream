---
name: Grupos de permissão consolidados
description: Estrutura oficial de 8 grupos de permissão globais após a simplificação de acessos (ago/2026).
type: feature
---

Estrutura oficial (todos GLOBAIS, `company_db = NULL`):

1. Admin
2. Contabilidade & Fiscal (fusão de Contábil + Fiscal)
3. Facilities
4. Financeiro (absorveu CFO, Contas a Pagar e PagCorp)
5. Financeiro - Contas a Receber (único com módulo `sales`, mantido separado de propósito)
6. Gente e Gestão
7. Usuário Administrativo
8. Usuário (base)

Regras:
- Não recriar grupos por empresa (sufixo "· SBO_XXX"): o vínculo do usuário é global.
- Não recriar CFO, Contas a Pagar, PagCorp nem Contábil — foram consolidados.
- Novo grupo só quando houver conjunto de módulos realmente distinto; se for subconjunto de um existente, use o existente.
