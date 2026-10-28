# Corrigir documentos e duplicidades no Histórico de Aprovações

## Resultado e escopo
- Exibir o número real do pedido, identificar o esboço separadamente e exportar os mesmos dados da lista.
- Unificar a mesma decisão SAP/HANA por esboço e aprovador, preservando autor, horário e substituição registrados pelo ERP Flow.
- Corrigir somente o Histórico e o registro de metadados das decisões SAP; não alterar pedidos, alçadas, acessos ou outras telas.
- Executar uma correção histórica idempotente apenas em `SBO_ANAGAMING`, `SBO_CACTUS`, `SBO_INSTITUTO_ANA` e `open_gaming_sa`.

## Etapas
1. Registrar a contagem inicial de “Minhas / Este ano” de Douglas usando os mesmos aliases e período da consulta autenticada, antes de gravar qualquer correção.
2. Enriquecer a auditoria das novas decisões com esboço, tipo de objeto e documento final quando comprovados no SAP. A gravação atual está em `Approvals.tsx`; a única alteração permitida ali será esse registro, sem mudança visual ou no fluxo de aprovação.
3. Recuperar esboços históricos pelo código de ApprovalRequest usando Apiuser, em lotes com limites de tempo e concorrência. Cruzar com a fonte HANA para número final e solicitante.
4. Quando a consulta SAP não resolver, usar fornecedor + valor + data da decisão (mesmo dia ou ±1), apenas se houver um único esboço candidato. Casos ambíguos ficam sinalizados, sem associação inventada.
5. Separar a lista de aprovadores HANA e resolver cada identidade no diretório canônico. Nomes ambíguos não recebem e-mail de outra pessoa. Sem horário individual comprovado, sinalizar “decisão do documento”, sem inventar horário.
6. Conciliar fontes antes da contagem, paginação e exportação, mantendo a decisão do Flow enriquecida. Não fundir decisões diferentes, rejeições com aprovações ou objetos diferentes.
7. Testar com dados sintéticos, publicar somente as funções afetadas e executar a correção histórica autorizada; ler os resultados de volta.

## Apresentação
- Documento final confirmado: **Pedido #7974**, com **esboço #8682** em texto secundário.
- Sem documento final: **Esboço #<n>**; número provisório nunca será apresentado como pedido final.
- Sem identificação confiável do esboço: informar documento não identificado, preservando o número provisório apenas como metadado.

## Validação e entrega
- Testes concretos: 8964/Gamify passa de número provisório 7952 para pedido 7974 e esboço 8682, com solicitante Thiago Moreira; preserva as duas decisões de Douglas Ferreira e Douglas Vinicius.
- Cobrir deduplicação por identidade canônica, substitutos, candidatos ambíguos, documento sem pedido final, rejeições, datas sem hora individual e restrição por empresa/usuário.
- Informar por empresa linhas corrigidas e linhas sem pedido final, exemplo 8964 antes/depois, contagem de Douglas antes/depois e arquivos alterados.
- Conferência de navegador em solicitação separada, conforme a regra do projeto. Não criar aprovações reais para testar.

## Detalhes técnicos
- Preferir metadados estruturados em `approval_history.raw` (`draft_entry`, `po_doc_num`, `requester_name`, origem/confiança da associação e precisão da data), sem migração se as colunas existentes forem suficientes.
- Helpers focados de resolução, normalização e conciliação com testes; preservar watermarks, escrita em lotes, limites remotos e liberação de trava em `finally`.
- Revisar `approval-history-sync/{index.ts,my-decisions.ts,audit-batch.ts}`, `useApprovalHistory.ts` e `ApprovalHistory.tsx`; registrar a decisão estrutural em `AGENTS.md`.
- Backfill com autenticação já autorizada pelo sistema e escopo validado no servidor; não relaxar MFA, RLS ou validação de identidade para executar.
- Para registros substituídos por versões canônicas, manter metadados de supersessão em vez de apagar a trilha original; consultas e exportações excluem apenas os duplicados comprovados.

## Condição de liberação
GO somente com testes passando e leitura de volta consistente; se a execução autorizada for recusada, informar o bloqueio sem declarar a correção de dados aplicada.