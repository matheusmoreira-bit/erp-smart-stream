# Base de backup dos documentos da Cactus Providers

Objetivo: trazer para o ERP Flow (banco + arquivos) uma cópia completa dos documentos da Providers no SAP, com anexos, de forma que os dados possam ser devolvidos ao SAP depois de um wipe da base.

## O que será copiado

| Documento | Origem no SAP |
|---|---|
| Pedidos de compra | PurchaseOrders |
| NF de entrada | PurchaseInvoices |
| Contas a pagar (pagamentos a fornecedor) | VendorPayments |
| Pedidos de venda | Orders |
| NF de saída | Invoices |
| Contas a receber (recebimentos) | IncomingPayments |
| Adiantamentos | PurchaseDownPayments e DownPayments |
| Anexos | Attachments2 de cada documento acima |

Cada documento é guardado inteiro (cabeçalho + linhas + impostos + rateios), exatamente como o SAP devolve, para permitir a devolução depois.

## Onde os dados ficam

- Tabela de documentos: uma linha por documento, com empresa, tipo, número, data, parceiro, valor, moeda, situação e o conteúdo completo em JSON. Chave única por empresa + tipo + documento, então repetir a cópia não duplica nada.
- Tabela de anexos: uma linha por arquivo, com nome, extensão, tamanho, hash e o caminho no arquivo do ERP Flow.
- Bucket privado `sap-archive` para os arquivos, organizado por empresa/tipo/documento.
- Tabela de execuções: registro de cada cópia (início, fim, tipo, quantos documentos, erros) e o cursor de onde parou.
- RLS em todas: leitura só para administradores; escrita só pelas funções de servidor.

## Como a cópia roda

Nova função de servidor `sap-archive-pull`:
- Recebe empresa e, opcionalmente, os tipos a copiar.
- Copia em blocos pequenos (20 documentos por página) ordenados por número interno, guardando o cursor a cada bloco — o SAP está lento, então cada chamada processa só o que cabe na janela de tempo e devolve `next_cursor`; a tela continua chamando até terminar.
- Incremental: nas rodadas seguintes só busca documentos novos ou alterados desde a última cópia.
- Erro em um documento não derruba o bloco: fica registrado com a mensagem e é retentado na rodada seguinte.

Função `sap-archive-attachments`: baixa os arquivos dos anexos ainda não copiados e grava no bucket, em lotes, com o mesmo padrão de cursor. Arquivo já existente com o mesmo hash é pulado.

Uma rotina diária mantém o backup em dia enquanto a Providers estiver nesse modo.

## Como devolver ao SAP

Função `sap-archive-restore`, sempre com simulação primeiro:
- Modo simulação (padrão): valida cadastros necessários (fornecedores, clientes, itens, centros de custo, projetos) e lista o que falta, sem gravar nada.
- Modo real: recria os documentos na ordem de dependência (pedido de compra → NF de entrada → pagamento; pedido de venda → NF de saída → recebimento; adiantamentos antes das notas que os consomem), reenvia os anexos e grava o de-para entre o número antigo e o novo numa tabela de mapeamento.
- Idempotente: documento já restaurado é pulado; a restauração pode ser retomada de onde parou.
- Cada documento restaurado guarda a referência ao número original para auditoria.

## Tela

Em Integrações → Credenciais, um cartão "Backup de documentos (SAP)":
- Contagem copiada por tipo e data da última cópia.
- Botão "Copiar agora" (com barra de progresso, continuando automaticamente até o fim) e "Copiar anexos".
- Botão "Simular restauração" mostrando pendências, e "Restaurar" protegido por confirmação explícita com o nome da empresa.
- Histórico das últimas execuções com erros visíveis.

## Detalhes técnicos

- Autenticação das funções por `requireSchedulerOrAdmin`, mesma base do `standalone-snapshot`; leitura do SAP com bypass do modo standalone (a Providers está sem integração).
- Reuso de `sapFetch` (timeout + retry) e do padrão de sessão do `sap-list-service`; páginas de 20 e limite de tempo por chamada para evitar "Failed to fetch".
- Anexos usam `Attachments2` e o download do conteúdo do arquivo pelo Service Layer; na restauração, o anexo é recriado e marcado com "Copiar para documento de destino" via `sap-attach-copy`.
- Migration adiciona as tabelas com GRANTs e políticas de RLS restritas a administradores; nenhuma tabela existente é alterada.
- Auditoria: cada execução e cada restauração geram registro de auditoria com empresa, tipo e totais.
