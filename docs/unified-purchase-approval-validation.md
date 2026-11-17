# Alçada única — validação de 17/11/2026

## Resultado aplicado
- Uma decisão de Juliana Gavineli ou Mauricio Farias por documento no Flow, inclusive rateios e reembolsos.
- 12 matrizes de empresas existentes/ambientes Test configuradas; zero regras anteriores ativas para compras. Regras compartilhadas permanecem como vendas, sem mudar seus critérios ou aprovadores.
- 51 pendências de produção e 10 Test transferidas para Juliana. Contagens lidas novamente: ANA 24, Cactus 27, Test ANA 8, Test Open 2.
- Nenhuma decisão concluída modificada. Regras e segmentos anteriores preservados em snapshots auditados; eventos anteriores não aprovam automaticamente os documentos transferidos.
- Reexecução na ANA retornou `already_applied=true`, sem nova transferência.

## Arquivos alterados
- `drizzle/migrations/0076_unified_purchase_approval.sql` e metadados gerados: operação transacional por empresa, verificação admin/MFA, snapshots e transferências.
- `supabase/functions/_shared/unified-purchase-approval.ts`: resolução da configuração e alternativas elegíveis.
- `supabase/functions/_shared/rateio-segments.ts`: não cria cadeias adicionais quando a empresa usa aprovação única.
- `supabase/functions/approval-rule-manage/index.ts`: operação autenticada, executando RPC com o JWT real do solicitante.
- `supabase/functions/expense-mutation/index.ts`: criação, edição e submissão resolvem a regra no servidor.
- `supabase/functions/expense-approval-action/index.ts`: ambas alternativas podem decidir; solicitante continua bloqueado.
- `supabase/functions/expense-attachment-storage/index.ts`: ambas alternativas elegíveis podem ler os anexos desse documento.
- `supabase/functions/approvals-feed/index.ts`: exclui trilhas substituídas da fila atual.
- `src/lib/unified-purchase-approval.test.ts`, tipos regenerados, `AGENTS.md`, `roadmap.md` e este relatório.

## Testes executados
38 testes passaram em quatro arquivos: alçada única, reprocessamento, rematch e visibilidade por segmento. Validam etapa única, qualquer alternativa suficiente, encaminhamento para Juliana, exceção quando ela solicita, exclusão de vendas e rejeição de unanimidade.

Ensaio real com sessão autenticada via ferramenta de funções: pedido sintético de R$ 3 em Test, duas linhas CC/projeto diferentes e reembolso, anexo TXT sintético enviado e persistido, submissão para Juliana, leitura do feed com Juliana/Mauricio e zero segmentos. Tentativa do criador/admin de aprovar recebeu 403 `self_approval_guard`. Pedido sintético cancelado, sem envio ao ERP. Sessão de shell injetada não continha MFA e foi recusada; a sessão real da ferramenta passou, sem substituir nem adulterar claims.

## Segurança e limites
| Verificação | Resultado |
|---|---|
| RLS nas cinco tabelas utilizadas | OK, habilitado; políticas existentes não alteradas |
| Nova operação administrativa | OK, JWT autenticado, admin + aal2 na função e no banco; revogada execução anon/PUBLIC/service_role |
| Atomicidade, escopo empresa/Test e auditoria | OK, locks por empresa, backups e transferência na mesma transação |
| Segredos no frontend/comandos/logs | Nenhum novo segredo; variáveis lidas em tempo de execução |
| Autoaprovação | Bloqueio real 403 e testes de elegibilidade |
| Entrada e CORS da operação nova | Empresa/ambiente validados e origem restrita pelo caminho existente; RPC parametrizado |
| HTTPS/HSTS | HSTS presente nas respostas; exceção HANA anterior não alterada |
| Políticas RLS escopadas de todo o projeto | Não revalidadas integralmente; nenhuma relaxada nesta alteração |
| Senhas, verificação de e-mail, brute force e SSO | Não alterados nem revalidados |
| CSP, criptografia de PII, CodeQL e secret scanning | Não revalidados globalmente |

Revisão orientada pela skill `revisao-seguranca-lovable`: entrada empresa/ambiente vai para consulta parametrizada após MFA/admin, sem SQL dinâmico, alteração de identidade ou URL controlada pelo cliente.

**GO** para a configuração e transferência verificadas no Flow. **NO-GO** para declarar cobertura externa/validação integral: decisões reais como Juliana/Mauricio não foram executadas nem sessões impersonadas; conferência visual aguarda solicitação separada conforme orientação do projeto. ANA/Cactus/Instituto retornaram zero pendências nativas SAP; Open Gaming devolveu 401 SLD no login, impedindo inventário. Nenhuma alçada nativa SAP/Omie foi alterada.