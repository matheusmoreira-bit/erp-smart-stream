# Plano de ação — itens restantes da avaliação

Sequência em 4 ondas. Cada onda é entregue e validada antes da seguinte.

## Onda 1 — Segurança (fazer agora)

1. Fechar a leitura pública da lista de empresas. Hoje qualquer visitante sem login enxerga o endereço de conexão com o SAP, o CNPJ e a razão social. Passa a exigir login; se alguma tela pública precisar, expõe só nome e código.
2. Restringir as 56 funções internas do banco que qualquer usuário logado pode executar hoje. Ficam liberadas apenas as usadas pelo aplicativo, e cada uma valida o papel de quem chama.
3. Declarar o acesso das 3 tabelas que estão protegidas sem nenhuma regra (registro de auditoria de pedidos, cache de chamadas e limite de requisições): uso exclusivo do serviço.
4. Mover a extensão instalada na área pública do banco para a área reservada.

Risco: baixo. Validação: varredura de segurança limpa nesses pontos e login/aprovação funcionando normalmente.

## Onda 2 — Espaço e estabilidade

5. Concluir a limpeza da trilha de auditoria (em andamento) e compactar a tabela para o espaço voltar ao disco.
6. Definir retenção de 30 a 90 dias para as medições de saúde do HANA, métricas das funções, lembretes de vencimento e envios de notificação, com limpeza diária junto das rotinas de poda já existentes.
7. Investigar os 3,5 milhões de gravações revertidas e corrigir o ponto de conflito (provável escrita concorrente nos caches de integração).

Ganho esperado: disco de 80% para cerca de 30–40%.

## Onda 3 — Performance

8. Reescrever o relatório de último acesso (hoje 4,4 s, picos de 7 s) com índice adequado ou resultado pré-calculado.
9. Reduzir as consultas à lista de fornecedores (293 mil) com cache no aplicativo e menos recargas de tela.
10. Nos caches do SAP, gravar só o que mudou em vez de reescrever tudo a cada sincronização.

## Onda 4 — Organização

11. Consolidar rotinas automáticas sobrepostas: 5 de nota de entrada, 4 de WhatsApp e 3 de arquivamento.
12. Reforçar o cadastro único de usuário entre domínios de e-mail (causa recorrente de erro em senha, permissão e notificação).
13. Unificar as cinco telas de auditoria em uma só, com abas.

## Detalhes técnicos

- Onda 1: migração removendo a policy `Public can read active companies` (ou restringindo a `authenticated` com colunas limitadas via view), `REVOKE EXECUTE ... FROM authenticated/anon` nas funções `SECURITY DEFINER` administrativas mantendo `service_role`, GRANT explícito só para `service_role` em `expense_audit_log`, `auth_caller_cache`, `edge_rate_limits`, e `ALTER EXTENSION ... SET SCHEMA extensions`.
- Onda 2: `purge_audit_trail_payloads` segue no cron de 5 min até `remaining = 0`; depois `VACUUM (FULL)` em janela de baixa carga. Retenções novas entram na função de poda diária existente (`prune-integration-data`).
- Onda 3: `get_flow_last_login` reescrito com índice em (user, created_at desc) ou tabela materializada atualizada por trigger/cron; caches SAP com comparação de hash antes do upsert.
- Onda 4: consolidação de cron jobs mantendo os endpoints atuais, apenas reduzindo frequência e agrupando chamadas.

## Pendência separada

Pedido #2666 (Bruna, 09/09) está com valor zero. Precisa decidir: corrigir o valor (informe o correto) ou devolver ao solicitante para refazer.
