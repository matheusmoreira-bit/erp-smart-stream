# Pedido de venda da Open Gaming (criado no SAP) não chega para o Mauricio

## O que já sabemos
- O pedido foi criado direto no SAP da Open Gaming. No ERP Flow não existe nenhum pedido de venda da Open.
- A regra "Vendas - Aprovador único" da Open Gaming está ativa, com Mauricio Farias (mauricio.farias@anagaming.com.br) como aprovador.
- Pedidos criados no SAP só aparecem no Flow se o SAP colocar o rascunho em aprovação (procedimento de autorização do próprio SAP). O Flow então lê essa fila e mostra para o aprovador definido no SAP.
- Na ANA funcionou ontem, então a leitura da fila do SAP funciona; o problema deve estar na configuração da Open.

## Passos
1. Procurar o pedido na fila de aprovação do SAP da Open Gaming (rascunhos pendentes de hoje) e ver para quem o SAP mandou.
2. Comparar com a ANA:
   - existe na Open um modelo de aprovação do SAP para pedido de venda?
   - o Mauricio está como aprovador nesse modelo e o usuário SAP dele está ligado ao e-mail certo?
3. Conforme o resultado:
   - **Sem modelo de aprovação no SAP da Open:** o pedido foi gravado direto, sem aprovação. Alguém com acesso ao SAP precisa criar o modelo, ou o pedido passa a ser lançado pelo ERP Flow (recomendado, porque lá a regra já está certa).
   - **Modelo com outro aprovador:** alguém com acesso ao SAP troca para o Mauricio, ou cadastra o Mauricio como substituto.
   - **Está na fila mas não aparece no Flow:** corrijo a ligação entre o usuário SAP e o e-mail dele no Flow e atualizo a cópia da fila.
4. Confirmar que o pedido aparece em "Para Aprovar" para o Mauricio e responder o e-mail dele.

## Riscos
- Mudanças nos modelos de aprovação do SAP não são feitas pelo Flow, e sim por quem administra o SAP.
- Nada é alterado no SAP sem confirmação de vocês.
