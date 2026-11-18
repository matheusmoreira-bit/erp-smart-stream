# Reteste da sessão — 18/11/2026, 14:10 UTC

## Resultado

**NO-GO para ativação.** O bloqueio continua desligado. Nenhuma alteração funcional, de perfil, permissão, credencial ou dado de negócio foi realizada.

## Evidências

- Sessão fornecida restaurada somente na origem local do navegador, sem imprimir credenciais.
- `/backoffice/controle-acesso` exibiu **Verificação em duas etapas**, confirmada por captura visual.
- RPC `erp_access_status`: `enabled=false`, `manager=false`, `ready=false`, `version=2`.
- A consulta do nível de autenticação pelo cliente retornou níveis nulos; não comprova MFA. As recusas explícitas do servidor abaixo são a evidência de que a sessão recebida não foi aceita para administração.

| Consulta publicada | Sem sessão | Com sessão recebida |
|---|---|---|
| user-profile-save, list | 401 | 403, segundo fator obrigatório |
| cashflow-forecast, empresa sintética inexistente | 401 | 403, segundo fator obrigatório |
| license-analysis | 401 | 403, segundo fator obrigatório |
| cnpj-lookup, CNPJ sintético inválido | 401 | 401, sessão válida obrigatória |

Essas recusas não demonstram o resultado posterior de regras de empresa, pois ocorreram antes dessa validação. Nenhuma resposta de sucesso ou acesso indevido foi observado nesses casos.

## Testes isolados

`bunx vitest run src/lib/erp-resource-access.test.ts src/lib/erp-access.test.ts src/lib/automation-auth.test.ts`

**47 testes aprovados**, incluindo cenários sintéticos autorizados e não autorizados. Eles não substituem tarefas reais nas sessões de Mauricio, Juliana e Artur.

## Pendências

Falta uma sessão legitimamente aceita com MFA para o teste administrativo e sessões legítimas das três pessoas para comprovar suas tarefas. Estar logado no preview não garante que a sessão fornecida às ferramentas herde o segundo fator. Nenhuma proteção foi contornada e nenhuma operação SAP/financeira real foi executada.

## Retomada às 14:15 UTC — MFA confirmado pela ferramenta administrativa

Esta retomada supera a limitação administrativa anterior: a chamada publicada `erp-access-manage`, usando a sessão atual do preview, respondeu **200, manager=true**, e `user-profile-save/list` respondeu **200**. O navegador local ainda recebe uma sessão que exibe MFA; esses dois canais não carregam a mesma comprovação. Não pedir repetição do código como solução garantida.

- Gestão com MFA: status confirmou as cinco pessoas (seis contas), `enabled=false`, `ready=false`, versão 2.
- Tentativa de ativação pelo caminho administrativo, versão 2: **403, cobertura ainda não verificada**. Status lido novamente: desligado e versão intacta, sem ação persistida.
- Listagem PagCorp pela sessão administrativa: **200**, sem registros para a empresa sintética inexistente. Isso é esperado para administrador e não comprova negação por empresa para usuário comum.
- As mesmas consultas de gestão e PagCorp com token inválido: **401**.
- Catálogo público: nenhuma tabela sem RLS nem tabela fora da configuração com menos/mais de quatro políticas de admissão foi encontrada.
- Seis RPCs representativas conferidas no banco têm `assert_erp_rpc_access`.
- **47 testes isolados aprovados novamente**.
- Ensaio PostgreSQL temporário com migrations 0077–0079: passou retenção das cinco pessoas, bloqueio de outro admin/sessão existente, RLS/Storage/RPC, MFA, proteção dos responsáveis, concorrência, liberação individual e restauração por Douglas; quatro ações auditadas. Servidor temporário encerrado, sem alteração da produção.

### Bloqueadores reais restantes

1. As sessões legítimas de Mauricio, Juliana e Artur não estão disponíveis; a sessão de Hiller não prova tarefas permitidas como eles. Os cenários equivalentes isolados passaram, mas não representam teste completo de SAP/Omie nas três contas.
2. `external-approvals-api` pode aprovar/rejeitar via chave técnica e usuário delegado sem verificar admissão; sua RPC `check_external_api_access` conferida no banco verifica apenas a allowlist da API, não o bloqueio ERP. As APIs de leitura `expense-tracking-api` e `pagcorp-status-api` também usam chaves técnicas sem identidade humana vinculada. É necessária uma revisão específica de identidade delegada versus automação para fechar esse caminho sem interromper integrações legítimas; não revogar chaves nem restringir todas as rotinas silenciosamente.
3. `resend-missing-attachment-notifications` ainda gera URLs de sete dias. Links previamente assinados não passam novamente pela RLS; falta tratamento explícito da janela residual, sem apagar anexos.

**NO-GO para ativação integral.** A cobertura não foi marcada artificialmente como verificada. Nenhum perfil, papel ou credencial alterado; arquivos alterados nesta retomada: este relatório e roadmap.md. Não declarar falha no MFA atual da ferramenta administrativa.