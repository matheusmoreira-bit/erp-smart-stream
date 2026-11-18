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