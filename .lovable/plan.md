# Restrição da página web, sem interromper integrações

## Resultado
- Somente Hiller Brandão, Douglas Vinicius, Mauricio Farias, Juliana Gavineli, Artur Angelo, Fernanda Faria, Flavia Alves (flavia.alves@growth.gg) e Bruna Padilha poderão abrir as telas internas do ERP Flow, mantendo seus perfis e permissões atuais.
- Os demais usuários verão uma tela de acesso temporariamente indisponível, inclusive quando já estiverem conectados.
- As integrações continuarão com sua configuração atual. O bloqueio global existente permanecerá desligado.
- Hiller e Douglas poderão liberar uma pessoa ou restaurar o acesso web de todos, com confirmação e MFA.

## Limite explícito
Esta é uma restrição da interface web, não uma revogação das credenciais nem uma garantia contra chamadas diretas. Não serão removidas as verificações existentes de autenticação, empresa, responsável, papel, RLS ou assinatura das integrações. As páginas de login e os links externos de aprovação terão seu comportamento atual preservado; os links externos não dão acesso às telas internas.

## Implementação
1. Criar configuração independente para a restrição web, inicialmente desligada, reutilizando as identidades confirmadas dos oito usuários e as contas administrativas de recuperação. A conta informada de Flavia não foi encontrada: não criar nem substituir essa conta automaticamente; impedir a ativação até existir uma conta confirmada e incluída na lista.
2. Verificar a identidade no servidor e usar o resultado para impedir a abertura das telas internas; falhas de verificação não liberarão essas telas. Reavaliar sessões abertas periodicamente, na navegação e ao voltar à janela.
3. Acrescentar controles separados e claramente identificados na página Controle de acesso, sem alterar o controle global existente. Todas as alterações exigirão administrador de recuperação com MFA, controle de concorrência e registro de auditoria.
4. Testar usuários permitidos, não permitidos, sessão aberta, liberação individual, reabertura geral e recuperação administrativa. Executar regressões das integrações sem modificar chaves ou consumidores externos.
5. Ativar somente a restrição web após os testes e a confirmação de uma sessão administrativa com MFA; conferir que o bloqueio global continua desligado e que nenhum perfil foi alterado.

## Detalhes técnicos
- Configuração e RPCs próprios, separados de `erp_access_control.enabled`, com RLS e concessões mínimas. Identidades vinculadas a UUIDs, nunca a valores fornecidos pelo navegador.
- Manter intactos os verificadores de admissão das APIs e as políticas atuais de recursos e Storage.
- Testes pequenos para os oito usuários permitidos, negação dos demais, conta pendente, gestão exclusiva com MFA e independência entre restrição web e bloqueio global.
- Registrar a separação arquitetural em `AGENTS.md` e atualizar o roteiro de tarefas.

## Critério de entrega
GO para restringir as telas somente após verificar admissão, negação e recuperação administrativa. Não declarar bloqueio de acesso aos dados nem funcionamento externo ponta a ponta quando não houver acesso aos consumidores externos.