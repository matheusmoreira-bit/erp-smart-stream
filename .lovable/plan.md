# Mapeamentos de Cartões Corporativos — unificação e regra Cartão + Fornecedor

## O que muda para o usuário

1. **Indedutíveis vira aba** dentro de "Mapeamento de Cartões → SAP" (ao lado de Cartões, Fornecedores e Contas de baixa). O endereço antigo `/cartoes/indedutiveis` passa a abrir o mapeamento já na aba Indedutíveis; o botão da tela de transações e o menu apontam para lá.
2. **Nova aba "Cartão + Fornecedor"**: cada linha define
   - Cartão (lista dos cartões conhecidos da empresa)
   - Fornecedor (busca na base local)
   - Centro de Custo, Projeto, Item (para Pedido de Compra) e Conta Contábil (para LCM)
   - Ativo sim/não
   Com campo para testar: escolhe cartão + fornecedor e mostra qual regra seria aplicada.
3. **Ordem de aplicação ao integrar uma transação** (campo a campo, o mais específico vence):

```text
Cartão + Fornecedor  >  Cartão  >  Fallback da empresa
```
   O fornecedor considerado é o já definido na transação (regra de descrição, IA ou escolha manual). Se o usuário trocar o fornecedor no diálogo de integração, CC/Projeto/Item/Conta são recalculados — exceto campos que ele já editou manualmente. Um aviso mostra de onde veio cada valor.

## Detalhes técnicos

- **Migração**: tabela `pagcorp_card_supplier_mapping` (company_db, card_identifier, card_label, supplier_code, supplier_name, cost_center, project, item_code, account_code, is_active, timestamps, unique company_db+card_identifier+supplier_code). GRANT + RLS: SELECT para authenticated escopado por empresa acessível, escrita só admin/serviço; audit trigger existente (`enable_audit_on`).
- **Edge function `pagcorp-card-mapping`**: ações `list-card-supplier`, `save-card-supplier`, `delete-card-supplier` com validação de campos, escopo por company_db e registro em audit_log. Escrita exige admin ou módulo pagcorp com edição.
- **Hook** `usePagCorpCardMapping`: carrega também as regras combinadas; `resolve(tx, supplierCode?)` faz o merge por campo e informa a origem (`card_supplier` | `card` | `fallback`); `describe` passa a considerar conta contábil para LCM.
- **UI**: novo `PagcorpCardSupplierTab.tsx`; `PagCorpNondeductible` convertido em componente de aba (`PagcorpNondeductibleTab`) reutilizando `useNondeductibleCards` e o diálogo existente; `PagCorpMapping` com Tabs controladas por `?tab=`; rota antiga redireciona.
- **Integração**: `PagCorpIntegrateDialog` (e integração em lote) passam o fornecedor resolvido ao `resolve`, e o LCM usa `account_code` da regra quando presente.
- Estados de loading, vazio, erro e sem permissão em todas as abas; testes unitários do merge de prioridade.
