# Automações seguras durante o bloqueio de acessos

## O que foi identificado

- **61 agendamentos ativos** já usam o segredo interno do agendador, consultado durante a execução. Nenhum deles usa somente uma chave externa de API. Preservar essas rotinas e seus horários.
- **Dados - Lotus:** chave externa ativa para acompanhamento de despesas, limitada aos projetos CASSINO e VERA; uso recente confirmado.
- **Aprovações - Thiago Moreira:** chave externa ativa para a API de aprovações, com último uso registrado em setembro. A chave não comprova quem está solicitando a operação.
- As duas chaves foram criadas por Matheus Moreira. Isso não prova que as automações devam parar, mas impede tratá-las automaticamente como identidades técnicas confiáveis.
- Um script de planilha consome a API de aprovações sem sessão pessoal e contém credenciais literais antigas. Não reutilizar nem reproduzir essas credenciais; preparar configuração segura e indicar a necessidade de rotação ao responsável.
- A API de status PagCorp também aceita chave legada; sua configuração e consumidores externos precisam ser confirmados sem divulgar valores.

## Resultado esperado

Automações aprovadas continuam executando suas consultas específicas, inclusive quando o bloqueio for ativado futuramente. Uma pessoa bloqueada não consegue usar uma chave compartilhada para entrar no ERP, consultar dados fora do escopo ou aprovar/rejeitar em nome de outra pessoa.

**Nesta etapa o bloqueio permanece desligado.** Contas, perfis, permissões pessoais, empresas, aprovações e horários não serão alterados.

## Implementação em fases pequenas

### 1. Identidade própria para cada automação

- Separar chamadas de máquina das chamadas pessoais; não conceder exceção apenas porque a chave é válida ou por um cabeçalho declarando “automação”.
- Cadastrar uma autorização técnica por consumidor, com serviço, operações de leitura, empresas, projetos, vencimento e revogação independente.
- Exigir uma prova adicional assinada por credencial exclusiva da automação, com validade curta e proteção contra repetição.
- Não entregar o segredo global do agendador ou uma credencial administrativa aos consumidores externos.
- Não converter as duas chaves existentes automaticamente em acesso técnico liberado. O cadastro só entra em operação após confirmação do consumidor e instalação segura da credencial.

### 2. Limites antes de qualquer consulta ou alteração

- Acompanhamento Lotus mantém CASSINO/VERA e recebe escopo explícito de empresas, sem ampliar os dados disponíveis.
- Status PagCorp fica limitado às empresas e operações cadastradas para sua automação.
- A API de aprovações poderá permitir **somente listagem técnica** nos escopos aprovados; aprovar/rejeitar continuará exigindo sessão pessoal admitida, identidade SAP própria e os controles existentes.
- Uma sessão pessoal inválida ou bloqueada nunca é substituída silenciosamente por autenticação de máquina.
- Impedir que a autorização técnica seja usada em outros serviços ou em telas, anexos, administração e operações não previstas.
- Registrar uso e recusas sem segredos, conteúdo financeiro ou dados pessoais desnecessários.

### 3. Consumidores e verificação

- Preparar o script de planilha e instruções de conexão para assinatura das requisições, sem credenciais no código nem redirecionamentos que possam encaminhá-las.
- Testar com dados sintéticos: automação autorizada, chave antiga sozinha, assinatura inválida/expirada/repetida, empresa/projeto alheio, tentativa de aprovação técnica, sessão bloqueada e revogação.
- Repetir os testes existentes de Mauricio, Juliana e Artur para impedir regressão nos controles pessoais; testes sintéticos não serão apresentados como tarefas reais nas contas deles.
- Verificar a implantação com chamadas inofensivas e confirmar que o bloqueio segue desligado.
- Atualizar o inventário e relatar quais consumidores externos foram efetivamente configurados e quais aguardam seus responsáveis.

## Detalhes técnicos

- Autorização de máquinas em tabela de aplicação com RLS habilitada e sem acesso anônimo; administração exige responsável de recuperação com MFA. Nenhum perfil pessoal será modificado.
- Segredos de assinatura exclusivamente no servidor/cofre e no ambiente privado do consumidor. Usar formulário seguro quando o responsável externo precisar receber/copiar a credencial; nunca imprimir valores em comandos, logs, respostas ou repositório.
- Assinatura vinculada ao identificador técnico, serviço, método, caminho, parâmetros e corpo, com timestamp e nonce; consumo atômico do nonce, prazo curto e limpeza limitada.
- Aplicar escopo persistido no servidor antes de leituras e efeitos; negar quando identidade, escopo ou verificação estiverem indisponíveis.
- Reaproveitar validadores de admissão e autorização existentes; documentar a distinção técnica no AGENTS.md e manter testes junto aos atuais.

## Dependências e limites

O Flow não consegue instalar credenciais nem alterar agendamentos em planilhas ou sistemas externos sem acesso a esses consumidores. Essa parte exige seus responsáveis, mas não impede preparar e testar a proteção no Flow.

**GO** para implementar e testar essa separação; **NO-GO** para ativar o bloqueio enquanto os consumidores necessários não forem configurados e comprovados. Os testes reais nas três contas e os links antigos de anexos continuam pendências separadas.