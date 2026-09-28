# ERP Flow — registro da versão de segurança 4.2

**Data:** 28/09/2026. **Estado:** candidata local, implementação e testes preparados; **não publicada, não implantada e sem encerramento operacional**. Versão documental 4.2; não altera automaticamente a versão do produto ou os relatórios PDF externos.

Base: [backlog V4.1](backlog-seguranca-v4.1.md), [revisão adicional N01–N04](security-additional-review-2026-09-28/README.md), [primeira rodada](security-remediation-2026-09-28/README.md) e [segunda rodada](security-remediation-2026-09-28/round2/README.md). Os registros históricos e hashes anteriores continuam representando o código que foi avaliado em cada ocasião.

## Correções de segurança desta candidata

| ID | Correção | Estado/evidência |
|---|---|---|
| N01 | `integration-auth` autentica antes de consultar dados e exige `integrate` na empresa efetiva do recurso para `nf_entrada`, `fiscal_audit` ou `employee_integration`. NF em lote exige identidade técnica. Agendadores `employees-sync-cron` e `audit-cross-fiscal-auto` também autenticam, evitando encaminhamento público com service role. | Implementado e validado localmente. Testes sem identidade, empresa divergente, usuário permitido e execução técnica. Gateway/deploy pendentes. |
| N02 | Criação/reprocessamento de Draft recusa NF cancelada, rejeitada no Flow/SAP ou concluída. Sem Draft existente, aceita apenas `pending_expense`/`integration_error`. A reserva revalida o estado corrente no PostgreSQL; cancelamento/rejeição/conclusão aguardam reconciliação enquanto houver criação em processamento ou incerta. O vínculo no handler usa comparação do status esperado para não sobrescrever uma alteração concorrente. | Implementado e validado localmente. Reabertura de NF rejeitada não foi adicionada; exige fluxo explícito aprovado. |
| N03 | Migração 0064 cria reserva durável exclusiva por NF; service role é o único papel de aplicação com acesso. Resultado incerto não provoca novo POST. Correlação `ERPFlow NF <id>` permite localizar o Draft após timeout ou falha de persistência. Confirmação durável precede vínculo no registro de NF. | Implementado e validado localmente, incluindo concorrência no PostgreSQL. Reservas de processos interrompidos podem exigir reconciliação assistida; ver operação abaixo. |
| N04 | Ator da execução de colaboradores deriva de identidade validada. Email/UUID e tipo `scheduled` enviados por usuários são ignorados como autoria. Execução técnica tem ator `service:integration-scheduler` e user_id nulo. | Implementado e validado localmente. Restrição TST permanece; nenhum dado real de colaboradores foi usado. |

Arquivos centrais: [integration-auth](../supabase/functions/_shared/integration-auth.ts), [nf-draft-once](../supabase/functions/_shared/nf-draft-once.ts), [migração 0064](../drizzle/migrations/0064_nf_po_draft_idempotency.sql). Os guards da rodada anterior continuam exigindo MFA/checagens de sessão para identidade Cloud apresentada; o novo helper usa esses guards.

A autenticação técnica usa correspondência com a service role configurada, preservando os schedulers atuais. Migração para credenciais técnicas mais restritas/rotação continua em B05/B13. Não se aceita cabeçalho de ator ou JWT apenas decodificado como prova.

## FUNC-01 — reaprovação de despesa integrada, fora do escopo de segurança

**Problema informado:** despesa aprovada e integrada, editada e aprovada novamente chegava ao SAP com valores zerados. **Objetivo:** PATCH com todo o conteúdo gravável do documento aprovado, preservando campos SAP que não são editados pelo Flow.

Rastreamento conferido: `expense-mutation` persiste itens validados → `expense-approval-action` dispara `expense-to-sap` com `patch_document` → handler carrega itens persistidos, normaliza os valores e monta o payload → Service Layer recebe PATCH e é relido para conferência.

O código já tentava realizar um PATCH completo, mas havia lacunas concretas: falha de leitura das linhas era ignorada; IDs de linha eram reconstruídos sequencialmente, mesmo com lacunas; ausência de linha na conferência de preço era tratada como ausência de erro; campos não enviados podiam conservar estado anterior (como gratuito/projeto). **Não foi capturado o incidente real no SAP**, portanto essas evidências não estabelecem qual dessas condições foi a causa exclusiva daquela ocorrência.

Alterações:

- Leitura do documento completo antes do PATCH é obrigatória; erro ou coleção inválida cancela o envio incompleto.
- Cabeçalho conserva campos graváveis selecionados e UDFs do SAP; campos aprovados no Flow prevalecem. Coleção completa de linhas é enviada com `B1S-ReplaceCollectionsOnPatch: true`, incluindo quantidades, preços, descontos, CC, projeto, descrições e campos personalizados.
- IDs existentes de linha são preservados, inclusive lacunas; linhas novas deixam a atribuição de ID ao SAP. A correspondência de linhas existentes continua posicional, conforme o modelo atual, sem identidade SAP persistida por item no Flow.
- `UnitPrice` e `Price` recebem o valor aprovado; gratuito passa explicitamente `tYES`/`tNO`; projeto/CC podem ser limpos quando a regra do Flow resolve valor vazio.
- Se o SAP recalcular preço para zero, o segundo PATCH de preços é aplicado e conferido. Ausência de linha, preço divergente persistente, desconto indevido ou linha não gratuita com total não positivo impede confirmação de sucesso.

“Completo” significa **campos editáveis + conteúdo aprovado**, não reenviar todo JSON de leitura. Totais calculados, IDs de documento, filial, moeda e datas contábeis originais continuam protegidos. Mantém-se a regra existente de não alterar `DocDate`/`TaxDate` no PATCH por restrições contábeis/FGR; `DocDueDate` é atualizado. Remoção total de anexos e alteração de campos não representados pelo formulário não foram adicionadas nesta rodada.

O contrato de PATCH foi conferido com a [referência oficial SAP Service Layer](https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html). Comportamento específico de add-ons, UDFs e período contábil requer homologação na base SAP correspondente.

**Teste integrado:** usa os trechos reais de montagem do payload, `sendDocument`, PATCH e verificação; simula a primeira gravação no SAP zerando o preço. Confirma segunda correção para 2 × 506,50 = 1.013,00, mantendo cabeçalho, anexo, UDFs, CC, projeto e ID de linha. Não substitui teste no ERP real.

## Evidências e comandos

| Verificação | Resultado |
|---|---|
| [Handlers/fluxo de reaprovação](security-v4.2-evidence/handler-tests.txt) | 12 testes passaram |
| [PATCH completo e preços](security-v4.2-evidence/patch-tests.txt) | 6 testes passaram |
| [Migração/concorrência SQL](security-v4.2-evidence/database-tests.json) | 6 cenários passaram em PostgreSQL local real; banco sintético removido |
| Regressões de segurança da rodada 1 | 15 testes passaram |
| Build frontend | Passou; aviso já existente de chunks grandes |
| Vitest geral | 247 passaram, 49 ignorados, 1 falha anterior em `report-pdf.test.ts:179` |
| [Deno nas quatro rotas centrais](security-v4.2-evidence/deno-comparison.json) | 25 erros antes/depois; sem novos diagnósticos por mensagem/arquivo. Checagem continua reprovada. |

[Manifesto dos arquivos desta rodada](security-v4.2-evidence/manifest.json).

```sh
node --test scripts/security-review/v42.test.mjs
npx vitest run src/lib/sap-document-patch.test.ts
node scripts/security-review/v42-database.mjs
node --test scripts/security-review/regression.test.mjs
npm test
npm run build
```

O script SQL conecta exclusivamente a `127.0.0.1:54322`, usa `docker/.env` local, cria um banco sintético com nome exclusivo e o remove ao terminar. Fixtures de handlers simulam Auth/DB/SAP nas fronteiras; testes SQL verificam unicidade concorrente, aquisição para reconciliação, grants e RLS. Nenhum acesso ao Supabase remoto ou SAP foi feito.

## Homologação e implantação pendentes

1. Aplicar a trilha de migrações em ambiente descartável representativo. **0063 e 0064 antes dos handlers novos**. A 0064 foi testada isoladamente com tabela NF mínima; replay integral permanece B14.
2. Confirmar grupos `integrate` para os três módulos e identidade técnica dos dois schedulers. Usuários com apenas `view` não devem executar integrações. Callers desconhecidos exigem inventário B13.
3. Revisar NFs com erro/resultado incerto anteriores à 4.2: Drafts antigos não têm a nova correlação por UUID. Reconciliar e vincular antes de permitir novo envio; a correlação nova não comprova ausência de Draft legado.
4. Homologar NFs canceladas/rejeitadas, duas chamadas simultâneas, timeout após POST, erro de vínculo local e resposta SAP inválida. Nunca retirar a reserva só porque um tempo passou.
5. Se um worker morrer e deixar `processing`, primeiro comprovar que não está ativo e buscar o Draft pela correlação. Operador autorizado pode mover a reserva específica para `uncertain`, permitindo **reconciliação sem novo POST**. Se não houver evidência suficiente do resultado anterior, manter bloqueada. Não há liberação automática nem botão que apague a reserva.
6. Repetir o caso real da despesa: integrar → editar itens, valores, CC/projeto, observações, vencimento/anexos → reaprovar → conferir documento completo no SAP, incluindo preços/totais e campos fiscais. Testar itens adicionados/removidos, IDs com lacunas, linhas gratuitas e UDFs; manter bloqueio de documentos cancelados/encerrados.
7. Registrar commit implantado, versões SAP/add-on, responsáveis e evidências do ambiente. Só então publicar a versão documental 4.2 final e encerrar operacionalmente N01–N04/FUNC-01.

Reservas evitam nova criação quando há incerteza, mas podem exigir intervenção para recuperar disponibilidade. Campos do SAP que não constam da lista de graváveis permanecem fora do payload; a homologação deve conferir os específicos de cada base. Não há promessa de transação distribuída entre PostgreSQL e SAP.

Os demais itens B01–B20 mantêm as pendências do backlog; esta versão candidata não declara todo o sistema seguro nem todos os testes verdes.
