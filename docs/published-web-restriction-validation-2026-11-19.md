# Validação da restrição web publicada — 19/11/2026

## Retomada às 11:53 UTC — sessão realmente bloqueada

- Criada conta temporária fora da lista via ferramenta gerenciada, sem alterar contas existentes, permissões ou configuração. A ferramenta informou ambiente compartilhado de produção e remoção automática ao encerrar o turno.
- Navegador local em `/login`, com a sessão temporária e sem interceptação de respostas: verificadores publicados retornaram admissão global verdadeira e admissão web falsa. A página exibiu **“Acesso negado”**, antes de login SAP ou MFA administrativo; `/compras` também recusou. Screenshots desktop e mobile inspecionados.
- Sessão existente do solicitante: admissão web verdadeira; chegou à verificação MFA existente. Isso confirma passagem pela restrição, não a execução das tarefas internas.
- Oito contas obrigatórias de sete pessoas continuam confirmadas e permitidas. Não houve login individual nas outras sete contas.
- 36 testes focados passaram, incluindo compatibilidade de chave válida com restrição web ativa e global desligada. MasterTax possui três registros `ok` posteriores à ativação, último em 11:49:07 UTC. As duas chaves externas continuam ativas, mas seus últimos usos são anteriores à ativação; consumidores Lotus e Thiago não foram exercitados.
- **Limite importante:** a conta temporária recebeu uma sessão gerenciada, não fez OAuth Google interativo. O fluxo pós-sessão foi comprovado com recusa real; Google completo e versão publicada continuam não verificados. Nenhuma sessão do ERP foi enviada ao Cloudflare.
- **GO** para a recusa pós-sessão no código atual; **NO-GO** para declarar Google/publicação e todas as exceções/integrações ponta a ponta. Alterados apenas este relatório e `roadmap.md`; nenhuma correção de aplicação foi necessária.

## Resultado

**NO-GO para declarar validação ponta a ponta da página publicada.** Nenhuma falha de aplicação comprovada; não alterar acesso, perfis, integrações ou proteção do Cloudflare com base nessa limitação.

- Os dois endereços publicados, `https://erp-flow.cactuscorporation.com` e `https://erp-smart-stream.lovable.app`, chegam à tela de login do Cloudflare Access. O navegador disponível não possui sessão dessa camada externa. O HTTP 200 é da tela de login, não do ERP.
- Não foi possível inspecionar a versão publicada, abrir uma tela interna publicada, observar usuário negado ou exercitar a reabertura na página publicada. A sessão gerenciada do ERP não autentica no Cloudflare Access; não restaurar seus tokens nesse domínio externo.
- Leitura independente da configuração: restrição web ativa, bloqueio global desligado, versão 4, oito contas de sete pessoas. Flavia não é obrigatória.
- Chamadas autenticadas aos dois verificadores publicados retornaram HTTP 200: sessão disponível admitida em ambos; gestão administrativa não autorizada nessa sessão (`manager=false`). No navegador local, `/backoffice` mostrou “Acesso negado / Sua conta não possui permissão de administrador”; não comprova falha da restrição web nem autoriza remover MFA.

## Integrações

- As duas chaves externas permanecem ativas e sem alteração. Último uso registrado: Lotus em 18/11; Thiago em 04/09. **Nenhum uso posterior à ativação comprovado.** Sem credenciais dos consumidores, não declarar teste positivo externo.
- Dez disparos de agendamentos entre 11:05 e 11:09 UTC têm estado `succeeded` no agendador. Isso confirma disparo, não o resultado das funções remotas. `integration_log` não apresentou registros posteriores a 11:05 UTC na consulta.
- A admissão das APIs consulta somente `enabled`, não `web_enabled`; autenticação e limites existentes foram preservados.
- Acrescentado teste executável específico: chave válida aceita com `web_enabled=true` e `enabled=false`, e recusada ao ativar `enabled` na fixture sintética. Não modifica produção.

## Testes e limites

- Testes focados do gate web, gestão, admissão de integração e prova técnica executados; resultado final registrado no roadmap.
- Screenshots locais da tela Cloudflare e do navegador restaurado inspecionados. Nenhum token incluído neste relatório.
- Nenhuma função, perfil, chave, política, configuração de acesso ou publicação foi alterada.
- Pendências: sessão legítima Cloudflare Access no navegador de teste, sessão autorizada de usuário negado, e execução real dos dois consumidores externos. Não usar dados reais ou impersonação não autorizada para simular resultados.