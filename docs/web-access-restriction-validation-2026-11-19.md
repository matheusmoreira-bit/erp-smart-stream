# Restrição web — validação de 19/11/2026

## Resultado
Preparação concluída; **NO-GO para ativação** até resolver os dois impedimentos abaixo. Nenhum usuário foi bloqueado, nenhuma integração ou perfil foi alterado.
Atualização às 11:05 UTC: **configuração da restrição web ativada**, após dispensa expressa de Flavia e confirmação administrativa de MFA. Sete pessoas/oito contas permanecem permitidas, bloqueio global desligado; integrações e perfis inalterados. O estado anterior acima descreve a preparação, não o estado atual.

## Ativação autorizada às 11:04 UTC
- Retirada somente Flavia das contas obrigatórias com auditoria e incremento para versão 3; conta não criada nem liberada.
- Status web autenticado confirmou `ready=true`, `manager=true`. Ação `enable` via endpoint MFA retornou HTTP 200, `enabled=true`, `admitted=true`, versão 4, com auditoria em nome de Hiller.
- Leitura independente confirmou `web_enabled=true`, `enabled=false`, oito contas. 42 testes passaram novamente.
- Preview restaurado confirmou admissão de Hiller e restrição ativa, mas a gestão visual ainda pede MFA nessa sessão restaurada.
- Não foi possível verificar o efeito na página publicada: domínio corporativo redireciona à proteção Cloudflare Access, sem sessão disponível para essa camada; URL pública alternativa também não forneceu o aplicativo à leitura. Ausência de scripts nessa resposta não prova versão desatualizada. Não houve publicação nem alteração de proteção externa.
- Liberação individual e reabertura geral permanecem disponíveis em Controle de acesso, seção Restrição da página web, mediante administrador de recuperação com MFA. Recuperação já testada no ensaio sintético; não foi desligada a configuração de produção para repetir esse ensaio.

## Retomada às 10:53 UTC
- MFA administrativo confirmado pelo endpoint publicado: status global e web HTTP 200, `manager=true`.
- Incluído `scope=web` no endpoint `erp-access-manage`, com enum validado, mesmo JWT/MFA e default global intacto. Função publicada e quatro testes de contrato acrescidos.
- Tentativa real autorizada de incluir `flavia.alves@growth.gg` retornou HTTP 400 “Conta confirmada não encontrada”. Consulta independente ao Auth retornou zero contas para esse e-mail. Não criada conta, não substituído e-mail, não alterada lista.
- Chamada com token inválido retornou 401. Todos os 42 testes passaram.
- Navegador restaurado ainda mostra MFA; as ferramentas de chamada publicada reconheceram o MFA, mas isso não verifica os controles visuais com a sessão restaurada. Nenhum código MFA foi pedido nem contornado.
- Restrição web e global mantidas desligadas, versão 2; não executada ação de ativação, conforme solicitação expressa do usuário.

## Identidades
- Confirmadas: Mauricio, Juliana, Artur, Douglas, duas contas de Hiller, Fernanda Faria e Bruna Padilha.
- Hiller corrigiu Flavia para `flavia.alves@growth.gg`; essa conta não existe no Auth. O diretório SAP contém Flavia Alves com outro e-mail, que não foi usado como substituição nem recebeu nova permissão.
- A ativação recusa contas obrigatórias ausentes/não confirmadas/não incluídas.

## Verificações realizadas
- 38 testes Vitest: cinco verificações de montagem/remoção da área interna, sete de admissão global e 26 de integrações/assinaturas.
- Ensaio PostgreSQL isolado com as migrations reais e dados sintéticos: oito pessoas/nove contas; conta pendente de Flavia impede ativação; outro administrador negado; MFA obrigatório; versão antiga negada; administradores de recuperação protegidos; admissão global independente; reabertura individual; desativação por Douglas; cinco alterações auditadas.
- Navegador com a sessão injetada: `/backoffice/controle-acesso` mostrou “Verificação em duas etapas”. Status web e global retornaram `enabled=false`, `admitted=true`, `manager=false`, versão 2. Não foi possível testar a gestão real além do MFA.
- Desktop 1280×1800 e mobile 390×844: tela MFA visível, sem erros de execução e sem transbordamento horizontal no mobile. Os controles administrativos ainda não foram inspecionados com MFA real.
- Último diagnóstico de compilação: OK.

## Limites e próximos requisitos
- Confirmar/criar a conta correta de Flavia pelo fluxo normal, sem criar conta automaticamente nem trocar e-mail SAP por inferência.
- Sessão administrativa de recuperação com MFA reconhecido para testar controles reais e ativar via RPC auditada.
- Esta restrição controla a interface web; não revoga credenciais ou acesso direto às APIs. Login e links externos de aprovação permanecem como antes. O bloqueio global e as proteções existentes de recursos/integrações não foram modificados.
- O funcionamento externo ponta a ponta das automações não foi declarado: consumidores externos não foram acessados.

## Arquivos alterados
- `src/App.tsx`, `src/components/ErpAccessGate.tsx`, `src/pages/ErpAccessControl.tsx`: navegação e controles separados.
- `src/components/ErpAccessGate.test.tsx`, `scripts/tests/erp-web-access-integration.py`: testes e ensaio.
- Migration `0082`, metadados gerenciados e tipos regenerados: campos e RPCs independentes.
- `AGENTS.md`, plano, roteiro e este relatório: decisão arquitetural e estado da entrega.