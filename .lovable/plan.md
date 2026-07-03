## Objetivo

Remover a entrada "Importar do PagCorp" da tela de Fornecedores e confirmar que o botão "Atualizar" já refaz o cache a partir do SAP.

## Mudanças

### 1. Remover a opção "Importar do PagCorp"
- Em `src/pages/Suppliers.tsx`: remover o botão "Importar do PagCorp" (linhas 374–377) e o ícone `Sparkles` do import, se ficar sem uso.
- Em `src/App.tsx`: remover a rota `/cadastros/fornecedores/importar-cartoes` e o import de `SuppliersImportPagCorp`.
- Apagar o arquivo `src/pages/SuppliersImportPagCorp.tsx`, que fica órfão.

Mantidos intactos: `useImportPagCorpSuppliers`, `PagCorpCandidateRow`, tabela `pagcorp_supplier_links` e demais integrações PagCorp usadas em outras telas (PagCorp, PagCorpMapping etc.). Somente a porta de entrada pela tela de Fornecedores é removida.

### 2. Botão "Atualizar" já atualiza o cache a partir do SAP

Verifiquei o fluxo atual e ele já faz exatamente o pedido — nenhuma alteração necessária:

- `Suppliers.tsx` (botão Atualizar) chama `refresh()` do hook `useSuppliers`.
- `useSuppliers.refresh` → `reloadSap()` do `useSapCachedList`.
- `useSapCachedList.reload()` chama `load(true)` (`forceRefresh = true`), que pula a leitura de `sap_cache`, faz `sapQueryAll` no SAP Service Layer (paginação completa via `sap-b1-proxy queryAll`, filtro `CardType eq 'cSupplier'`) e faz `upsert` do resultado em `sap_cache` com TTL de 1 semana.

Ou seja: cada clique em "Atualizar" já vai ao SAP, traz a lista completa de fornecedores e regrava o cache da empresa ativa. Vou apenas confirmar isso no código; não há mudança de comportamento aqui.

## Observação sobre o caso OpenGaming

Confirmado no diagnóstico anterior: o SAP da OpenGaming (`SBO_OPENGAMING`) tem exatamente 247 BusinessPartners, todos `cSupplier`, e o cache já reflete os 247. Ou seja, hoje o "Atualizar" já traria o mesmo resultado — se algum fornecedor específico não aparece, é porque não existe nesse CompanyDB (pode estar em `tst_open_gaming`, que tem 329). Posso investigar CardCodes/CNPJs pontuais depois, se quiser.
