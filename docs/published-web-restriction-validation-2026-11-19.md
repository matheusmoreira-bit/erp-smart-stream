# Validação da restrição web publicada — 19/11/2026

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