# Revisão adicional de segurança — 28/09/2026

Quatro achados adicionais ao diagnóstico V4.1, presentes no checkout local após as duas rodadas de correções. **Estado: abertos, reproduzidos localmente; exploração/deploy remoto não verificados.** Não houve acesso ao Supabase nem ao SAP, envio de mensagens ou alteração do código da aplicação nesta revisão.

**Atualização posterior:** N01–N04 foram tratados na [candidata local V4.2](../seguranca-v4.2.md). Este documento e suas reproduções preservam o diagnóstico anterior; encerramento de ambiente continua pendente.

## Resultado e prioridade

| ID | Achado | Impacto demonstrado | Prioridade proposta / backlog |
|---|---|---|---|
| N01 | Handlers de integração sem autenticação/autorização por usuário, empresa e ação | Pedido sem identidade chega a criação de Draft SAP, exclusão de resultados fiscais e gravação de execução de colaboradores nas fronteiras simuladas | Alta / P0; B01, B13 |
| N02 | NF por ID ignora elegibilidade do status | Notas `cancelled` e `erpflow_rejected` geram Draft e passam a `awaiting_sap` | Alta / P0; B19 |
| N03 | Criação de Draft sem reserva atômica/idempotência concorrente | Duas requisições para a mesma NF produzem dois Drafts | Alta / P1; B19 |
| N04 | Autoria da sincronização de colaboradores controlada pelo corpo | `triggered_by_email` arbitrário é enviado ao INSERT da execução | Média / P1; B20, B13 |

Esses IDs representam causas distintas, não quatro explorações independentes de produção. N01 e N04 compartilham uma rota; N01–N03 podem compor a mesma cadeia fiscal. As prioridades são propostas, sem CVSS ou aceite de risco.

## N01 — Autorização ausente em rotas que usam service role

**Evidências:** [nf-entrada-to-sap:131](../../supabase/functions/nf-entrada-to-sap/index.ts#L131), [audit-cross-fiscal-run:37](../../supabase/functions/audit-cross-fiscal-run/index.ts#L37), [employees-sync-run:19](../../supabase/functions/employees-sync-run/index.ts#L19). Nenhum desses handlers verifica caller, papel, módulo ou vínculo antes de acessar dados com service role.

- `nf-entrada-to-sap`: recebe ID de NF; sem ID, busca até 20 registros `pending_expense`. Carrega credenciais da empresa da nota e usa o SAP. Pausa da integração e modo standalone são controles operacionais, não identidade do solicitante.
- `audit-cross-fiscal-run`: recebe empresa/período, consulta adapter ERP e apaga resultados automáticos/ambíguos anteriores do período, com service role. Um teste com fontes vazias ainda alcançou a exclusão; não houve remoção de dados reais.
- `employees-sync-run`: recebe ID de configuração e inicia execução/lock/registro antes de qualquer autorização. A restrição **TST** é real e foi preservada na classificação. Não afirmar mutação em bases produtivas com nome fora dessa regra.

**Reprodução:** handler real com `Request` sem Authorization. NF e cruzamento respondem 200 com efeitos capturados; colaboradores grava a execução e termina 500 porque a fixture interrompe deliberadamente antes das integrações externas. Esse 500 não desfaz o efeito anterior.

**Pré-condições:** requisição precisa chegar ao handler; rotas implantadas, registros/configurações existentes, credenciais disponíveis e integrações habilitadas. Para chamadas por ID, conhecer um ID válido; a variante fiscal em lote não exige ID. As três rotas não têm entrada explícita em `supabase/config.toml` neste checkout. **Não foi demonstrado que o gateway publicado aceita anônimos.** Se ele aceitar apenas identidades autenticadas, ainda falta provar autorização por empresa/ação no handler. Não presumir que RLS de usuário restrinja o client de serviço.

**Correção proposta:** separar chamadas técnicas autenticadas de chamadas de usuário; autenticar antes das consultas; derivar empresa do recurso e exigir a ação correspondente. Cron deve ter credencial/escopo específico, sem fallback público. Inventariar callers antes de mudar contratos.

**Aceite:** sem identidade negado antes de qualquer efeito; usuário de outra empresa e perfil somente leitura negados; identidade autorizada e scheduler legítimo preservados; casos de MFA/impersonação incluídos. Retestar gateway publicado separadamente.

## N02 — Reprocessamento por ID revive nota cancelada/rejeitada

**Evidências:** [seleção por ID:144](../../supabase/functions/nf-entrada-to-sap/index.ts#L144), [process:76](../../supabase/functions/nf-entrada-to-sap/index.ts#L76), [mudança para awaiting_sap:111](../../supabase/functions/nf-entrada-to-sap/index.ts#L111). Apenas a seleção em lote filtra `pending_expense`; `process` verifica draft existente e empresa, mas não status. Os estados usados nos testes pertencem ao [tipo de NF da aplicação](../../src/hooks/useNfEntrada.ts#L5).

**Reprodução:** uma NF `cancelled`, e depois outra `erpflow_rejected`, ambas sem draft prévio, geraram uma chamada de criação de Draft e update para `awaiting_sap`. Resposta 200. Credenciais, fornecedor e linhas foram sintéticos.

**Impacto/limite:** ignora cancelamento/rejeição da aplicação e inicia documento de compra. Um Draft não equivale a pedido definitivo aprovado nem comprova pagamento. Corrigir N01 não basta: mesmo um caller autenticado pode acionar essa transição inválida.

**Correção proposta:** validar transição no servidor dentro do fluxo comum, incluindo chamada por ID; modelar explicitamente reprocessamento de erro autorizado. Recusar cancelada/rejeitada sem um fluxo distinto de reabertura aprovado.

**Aceite:** cancelada/rejeitada não consulta credenciais nem cria Draft; estado elegível funciona; reabertura explícita e auditada preserva autoria e aprovação.

## N03 — Corrida de criação de Draft

**Evidências:** [checagem do ID:77](../../supabase/functions/nf-entrada-to-sap/index.ts#L77), [criação:105](../../supabase/functions/nf-entrada-to-sap/index.ts#L105), [persistência posterior:111](../../supabase/functions/nf-entrada-to-sap/index.ts#L111). A checagem acontece no snapshot lido; não há reserva atômica antes de enviar ao SAP.

**Reprodução:** `Promise.all` executou dois handlers reais sobre a mesma fixture `pending_expense`, com `sap_po_draft_id=null`; ambos chegaram ao ERP simulado, criaram IDs distintos e tentaram atualizar o mesmo registro. Duas respostas 200, dois Drafts.

**Pré-condições:** duas requisições leem a NF antes da primeira persistir o ID. Pode ocorrer por concorrência legítima, botão/retry ou abuso; não exige acesso ao banco. O teste não prova ausência de controle adicional desconhecido no ERP publicado.

**Risco adjacente observado:** os retornos de erro do update/log após criar o Draft não são checados no código. Esse ramo foi identificado por leitura, não reproduzido nesta rodada; incluir falha de persistência e recuperação no teste de fechamento.

**Correção proposta:** reserva atômica por NF com recuperação de lock e estado; chave de correlação estável no ERP e reconciliação antes de repetir após timeout. Só bloquear concorrência local não resolve o intervalo entre criação remota e persistência local.

**Aceite:** múltiplas chamadas concorrentes geram no máximo um Draft; erro após criação é reconciliado; retries não perdem o vínculo; falha anterior à criação permite retomada. Validar com SAP de homologação.

## N04 — Autoria declarada pelo solicitante

**Evidências:** [employees-sync-run:64](../../supabase/functions/employees-sync-run/index.ts#L64) insere `triggered_by` e `triggered_by_email` diretamente do corpo. Não deriva esses campos de identidade verificada. A [migração da tabela](../../supabase/migrations/20260716164856_1e1e0dfc-82d4-4a7d-bef5-f352d2630c72.sql#L85) declara email como texto e usuário como FK nullable.

**Reprodução:** sem identidade, corpo contendo `triggered_by_email=claimed-admin@example.invalid` e sem `triggered_by` alcançou INSERT com esse email. A fixture capturou a operação, sem banco real. Usar UUID inexistente poderia falhar por FK; o teste não depende disso.

**Impacto:** registro de execução pode atribuir a iniciativa a email escolhido pelo solicitante; não demonstra adulteração de toda a trilha de auditoria ou tomada da identidade informada.

**Correção proposta:** derivar ator de claims verificados; para jobs, registrar identidade técnica e tipo de execução definidos pelo servidor. Tratar eventual solicitante declarado como campo separado, sem valor de autoria comprovada.

**Aceite:** email/UUID enviados no corpo não substituem o ator autenticado; jobs são distinguíveis de ações humanas; logs de sucesso e erro preservam o ator real.

## Método, exclusões e artefatos

Executar localmente com Node 24+:

```sh
node scripts/security-review/additional-findings.mjs
```

[Resultados](reproduction-results.json), [manifesto SHA-256](manifest.json) e [script](../../scripts/security-review/additional-findings.mjs). O script transpila os handlers reais e substitui somente imports/fronteiras externas por fixtures. Não há chamadas de rede, banco ou envio de mensagens. Ele **confirma o comportamento vulnerável atual**; não é teste de aceitação de correção e deverá ser convertido/invertido ao tratar os itens.

Não contar busca textual como achado: vários handlers delegam autenticação a helpers. `verify_jwt=false` isoladamente também não prova falta de autenticação. Preview de email possui verificação de chave; webhook delega a SDK e não foi classificado como aberto sem revisar a implementação correspondente.

O guard indireto de `expense-line-item-patch` baseado em SELECT também chamou atenção, mas a migração 0053 restringe a view `system_credentials_v` a service role. Não classificado aqui como bypass atual: dependeria de grants divergentes do deploy. Pode haver incompatibilidade funcional para admins e deve ser conferido em B12/B14.

Esta é revisão direcionada, não inventário exaustivo nem certificação do deploy. SSRF/dependências/grants globais continuam pendentes no backlog anterior.
