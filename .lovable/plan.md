# Preparação para o novo campo `aiAnalysis` da API PagCorp

A partir de 17/08 (já em homologação) cada despesa retornada pelo endpoint de despesas trará `aiAnalysis.companyName` e `aiAnalysis.companyDocument` (razão social e CNPJ do estabelecimento identificados no comprovante). A mudança é retrocompatível — hoje nada quebra —, mas dá para aproveitá-la para reduzir trabalho manual e custo de IA no fluxo atual.

## Situação atual (verificada no código)

- `pagcorp-proxy` repassa os itens brutos da API, então os novos campos chegam ao frontend sem alteração no proxy.
- `usePagCorp` normaliza a transação e hoje não tem nenhum dado de estabelecimento: o fornecedor exibido cai em `cardName`/`accountName` e o fornecedor real é escolhido manualmente na integração.
- `useImportPagCorpSuppliers` faz OCR por transação chamando a função `supplier-ai-extract` para descobrir razão social/CNPJ do comprovante — exatamente o dado que a PagCorp passará a entregar pronto.
- `cleanDigits` remove tudo que não é dígito e `hasValidBrazilianTaxId` exige 11/14 dígitos — isso quebra com o CNPJ alfanumérico anunciado.

## O que será feito

### 1. Normalizar o novo campo na leitura das transações
Em `usePagCorp.ts`, incluir no modelo `PagCorpTransaction` os campos `merchantName` e `merchantTaxId`, lidos de `aiAnalysis.companyName` / `aiAnalysis.companyDocument` (tolerando ausência/nulo, sempre como string). Nenhum comportamento existente muda quando vierem vazios.

### 2. Exibir o estabelecimento na tela do PagCorp
Mostrar razão social + CNPJ identificados no card/linha da transação (com fallback para o texto atual quando não houver `aiAnalysis`), para o operador conferir antes de integrar.

### 3. Sugestão automática de fornecedor na integração
Ao abrir a seleção de fornecedor de uma transação, pré-buscar pelo CNPJ do `aiAnalysis` (e, em segundo lugar, pela razão social), sugerindo o fornecedor SAP correspondente. A escolha continua sendo confirmada pelo usuário — nada é integrado automaticamente.

### 4. Usar `aiAnalysis` antes do OCR no importador de fornecedores
Em `useImportPagCorpSuppliers`, quando a transação já trouxer `companyName`/`companyDocument`, usar esses dados direto e pular a chamada a `supplier-ai-extract`. O OCR fica como fallback para transações sem `aiAnalysis`. Isso deixa o scan muito mais rápido e reduz custo de IA. O casamento com `pagcorp_supplier_links` e com a lista de fornecedores segue igual.

### 5. Tratar CNPJ alfanumérico
Criar uma normalização de documento que preserve letras (uppercase, sem pontuação) e usá-la nos pontos de comparação de CNPJ do fluxo PagCorp, mantendo a validação numérica atual apenas onde o SAP exige. `hasValidBrazilianTaxId` passa a aceitar também 14 caracteres alfanuméricos.

### 6. Validação em homologação
Rodar o scan de importação e a listagem de despesas contra a base de homologação para confirmar o formato do `aiAnalysis`, e registrar o comportamento esperado antes de 17/08.

## Detalhes técnicos

- Arquivos: `src/hooks/usePagCorp.ts`, `src/pages/PagCorp.tsx`, `src/hooks/useImportPagCorpSuppliers.ts`, e um helper de normalização de documento em `src/lib/`.
- Sem migração de banco e sem mudança em `pagcorp-proxy` ou nas funções de integração com o SAP.
- Todos os novos campos são opcionais: com resposta antiga (sem `aiAnalysis`) o sistema se comporta exatamente como hoje.

## Fora de escopo

- Criar fornecedor automaticamente a partir do `aiAnalysis` sem revisão humana.
- Expor o CNPJ do estabelecimento na API pública de status do PagCorp (ela é deliberadamente sem dados de fornecedor).
