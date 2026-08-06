# Plano de performance — carregamento das telas

## Diagnóstico (medido)

Medi as chamadas das últimas 24h e o gargalo **não é o Postgres**, é o caminho até o ERP e a autenticação repetida em cada requisição:

| Serviço | Chamadas | Tempo médio | Pior caso |
|---|---|---|---|
| `expense-read` (todas as telas de documentos) | 41 | 4,5 s | 32 s |
| `sap-list-service` (comboboxes: fornecedores, itens, CC, projetos) | 12 | 26,1 s | 65,9 s |
| `sap-purchase-orders-hana` (tela de Compras) | 15 | 15,0 s | 60,1 s |
| `sap-b1-proxy` | 37 | 2,1 s | 25,4 s |

Causas confirmadas ao ler o código:

1. **Autenticação cara por requisição.** `validateSapSession` executa, antes de qualquer cache, duas idas ao banco (revogação de sessão + verificação de desligamento no IdP) e, quando o token assinado não está presente, ainda faz uma chamada de rede ao Service Layer do SAP. Cada tela dispara várias requisições e todas pagam esse custo.
2. **Cache de identidade só na memória da instância.** `expense-read` guarda o caller por 60 s por instância; como as funções escalam/reciclam, a maioria das chamadas recalcula JWT + sessão SAP + grupos de permissão.
3. **Recorte de visibilidade em memória.** No modo escopado o `expense-read` busca até 2000 linhas e filtra em memória, além de consultar `expense_items` novamente para cobrir rateios — 2 a 3 consultas extras por leitura.
4. **Telas esperando o ERP ao vivo.** Compras e comboboxes consultam HANA/Service Layer de forma síncrona (15–26 s de média) em vez de servir o cache primeiro.
5. **Rotinas de fundo frequentes.** Vários crons a cada 5 minutos (`expense-sap-status-sync`, `overdue-reminders-dispatch`, `purge-expense-action-idempotency`) somados a polling de 5 s em alguns painéis mantêm carga constante.
6. **Banco em 77% de disco / 61% de memória**, com `audit_trail` em 1,5 GB e índices sem uso.

## O que será feito

### 1. Autenticação mais barata (maior ganho)
- Consultar o cache de validação **antes** das verificações de revogação/desligamento; manter essas verificações apenas na primeira validação e em intervalos maiores.
- Elevar o TTL do cache de sessão e executar revogação + desligamento em paralelo.
- Persistir o resultado da identificação do caller (privilégios, diretoria, aliases) em tabela de cache curta, para sobreviver ao reciclo de instância.

### 2. Leitura de documentos no servidor
- Trocar o filtro em memória por filtro em SQL: aplicar o recorte de dono direto na consulta e resolver rateio por diretoria com uma única consulta com `IN`.
- Adicionar índices de apoio em `expenses` (`current_approver`, `requester_email`, `created_by_email`, `company_db + status`) e em `expense_items (cost_center)`.

### 3. Telas cache-first
- Compras e comboboxes passam a renderizar imediatamente com o cache local/`sap_cache` e atualizar em segundo plano, em vez de bloquear a tela esperando HANA.
- Aumentar os intervalos de polling curtos (5 s) para 30–60 s nos painéis não críticos.

### 4. Higiene do banco
- Reduzir frequência de crons não críticos (5 min → 15 min) e tornar as sincronizações incrementais.
- Remover índices sem uso e arquivar/expurgar `audit_trail` antigo para liberar disco.

## Resultado esperado
Telas de documentos abrindo em torno de 1 s (hoje 4–30 s) e telas dependentes do ERP com render imediato via cache, com atualização em segundo plano.
