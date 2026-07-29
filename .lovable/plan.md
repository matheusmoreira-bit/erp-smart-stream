## Objetivo

Gerar um arquivo Markdown completo e autocontido sobre a **PagCorp Transaction Status API**, pronto para ser enviado ao time do outro projeto.

Hoje já existe `docs/pagcorp-status-api.md`, mas ele é um resumo curto. O novo documento será a versão de entrega (handover), cobrindo tudo que um integrador externo precisa sem depender do Swagger.

## O que o documento vai conter

1. Visão geral: o que a API faz, o que ela deliberadamente não expõe (sem valores, fornecedor, cartão, portador, anexos ou PII).
2. Base URL, versão e links para o contrato OpenAPI 3.1 e para o Swagger UI publicado.
3. Autenticação: header `x-api-key`, como a chave é emitida, e a regra de nunca embarcar em front-end.
4. Parâmetros de consulta em tabela: `transactionId`, `transactionIds` (máx. 200), `companyDb`, `updatedSince`, `limit` (1–200), `offset`.
5. Comportamento de resposta: objeto único quando `transactionId` é usado; lista `{count, items}` nos demais casos; apenas o registro mais recente por transação.
6. Dicionário de campos do payload, incluindo os cinco estágios de `erp.stage`: `not_posted`, `error`, `posted`, `invoiced`, `settled`, e como cada um é derivado.
7. Exemplos práticos de `curl` e respostas JSON para: transação única, múltiplas transações, filtro por empresa/data, e sincronização incremental por `updatedSince`.
8. Tabela de códigos de status (200/400/401/404/500/503) com a ação recomendada para cada um.
9. Boas práticas de consumo: paginação, polling incremental, tratamento de erro e limites.
10. Changelog/versão inicial 1.0.0.

## Detalhes técnicos

- Arquivo: `docs/pagcorp-status-api.md` (substitui o resumo atual pela versão completa), mantendo o Swagger UI e o spec OpenAPI como estão.
- Nenhuma mudança em edge function, banco ou front-end — apenas documentação.
- O conteúdo será derivado diretamente do código atual (`supabase/functions/pagcorp-status-api/index.ts` e `openapi.ts`) para não descrever comportamento inexistente.
