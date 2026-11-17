# Alçada única para compras e pagamentos de notas

## Resultado solicitado
- Substituir as alçadas anteriores de compras e pagamentos de notas por uma etapa: **Juliana Gavineli OU Mauricio Farias**. A decisão de um deles basta; não exigir os dois.
- Transferir as pendências desse escopo para Juliana, sem aprovar automaticamente nenhum pedido.
- Preservar decisões concluídas, histórico, credenciais, permissões, MFA e validações de segurança.
- Manter vendas fora desta alteração. Regras compartilhadas entre compras e vendas devem conservar seu comportamento de vendas.

## Execução por fases
1. Confirmar as identidades cadastradas dos dois aprovadores e inventariar compras, notas, rateios e pendências originadas no ERP, distinguindo documentos do Flow de documentos controlados pelo SAP/Omie.
2. Guardar uma versão das regras anteriores para reversão. Aplicar e testar primeiro em empresa Test com dados sintéticos.
3. Garantir uma etapa alternativa por pedido, inclusive rateios e reembolsos, sem mesclar indevidamente os contextos contábeis dos segmentos. Não reaproveitar decisões antigas para concluir automaticamente uma pendência transferida.
4. Desativar as regras anteriores do escopo e aplicar a configuração nas empresas correspondentes, respeitando a separação de empresas exigida pelo sistema.
5. Transferir pendências para Juliana com registro de antes/depois e conferir todas as páginas de resultados, sem o limite de 500 registros do reprocessamento atual. Se Juliana for a solicitante, encaminhar a Mauricio para impedir autoaprovação.
6. Validar contagens e leitura independente dos resultados; testar uma aprovação por cada alternativa e a proteção contra autoaprovação. Conferência visual autenticada em solicitação separada, conforme a regra do projeto.

## Detalhes técnicos
- Usar o caminho administrativo autenticado existente; não usar escrita SQL privilegiada ou autenticação de automação para contornar MFA do solicitante.
- Configurar os dois aprovadores no mesmo `level_order=1`, com `require_all=false`; adaptar o tratamento de segmentos somente onde necessário para assegurar uma única decisão por documento nesse escopo.
- Verificar a participação efetiva do segundo aprovador na lista e na ação de aprovação, não apenas o rótulo do aprovador atual.
- Notas já vinculadas a pedidos e aprovações nativas do ERP precisam ser inventariadas antes de alterações; não declarar transferência no SAP/Omie a partir de mudanças apenas no Flow.
- Testes específicos: uma etapa, alternativas Juliana/Mauricio, uma decisão suficiente, transferência pendente para Juliana, exceção de autoaprovação, vendas e decisões concluídas preservadas.

## Bloqueio atual
A chamada autenticada de verificação a `approval-rule-manage` retornou **HTTP 403**, exigindo segundo fator. Nenhuma regra ou pendência foi alterada. A execução depende de uma sessão administrativa com MFA comprovável disponível às ferramentas; confirmar MFA apenas na interface não garante essa disponibilidade.

## Critério de conclusão
Alçadas e pendências conferidas após a alteração, testes aprovados e ausência de mudanças de acesso. **NO-GO para aplicação enquanto o bloqueio administrativo persistir.**