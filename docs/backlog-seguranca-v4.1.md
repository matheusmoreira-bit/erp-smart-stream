# ERP Flow — Falhas abertas e backlog de segurança baseado no V4.1

**Data:** 28/09/2026. **Estado do backlog:** em execução; primeira rodada local registrada na seção 10. **Base documental:** `ERP_Flow_Relatorio_Seguranca_V4.1.pdf`, páginas 2–3. **Código da avaliação inicial:** `410a28c9081c44a2feefba450736025b61bf75c7`.

**Conclusão:** existem correções reais, mas não há suporte para declarar todas as brechas encerradas. Permanecem pendências explícitas do V4.1 e falhas de autorização reproduzidas localmente. Os V4.0 com anexos contêm referências que não correspondem ao checkout; essas alegações não devem gerar tarefas de correção como se estivessem comprovadas.

As seções 1–9 preservam o diagnóstico anterior às correções; o estado atual de execução está na seção 10. As referências E/R e seus hashes são históricos.

Este documento separa **estado declarado pelo relatório**, **estado técnico observado** e **estado de execução da tarefa**. Não houve acesso ao Supabase de produção ou à réplica nesta avaliação, nem alterações na aplicação. O PostgreSQL local ainda não contém o schema de negócio; portanto, não foi usado como evidência de RLS/grants produtivos. As cinco reproduções executam código real com fronteiras externas simuladas.

## 1. Fontes e precedência

| Fonte examinada | Uso nesta avaliação |
|---|---|
| ZIP `drive-download-20260928T164124Z-1-001.zip`: V4.1, 3 páginas, e memorando de verificação, 1 página | Base para os IDs F01–F15, estados declarados e pendências do backlog. Alegações de testes ao vivo não foram repetidas em produção. |
| `ERP Flow — Relatório de Segurança V4.0 com Anexos.pdf`, 6 páginas | Conferência das evidências alegadas; não prevalece sobre o V4.1. |
| `ERP Flow — Relatório de Segurança e Arquitetura V4.0.pdf`, 4 páginas | Histórico das conclusões e de F16–F20, também contestados pelo V4.1. |
| `ERP_Flow_Relatorio_Seguranca_V4.0.docx` | Histórico de F01–F15; diferencia correções técnicas e pendências. Não é o mesmo conteúdo dos PDFs V4.0 com achados novos. |
| `ERP_Flow_Relatorio_Seguranca.pdf`, 7 páginas, 24/09/2026 | Descrição original dos vetores F01–F15 e critérios de aceite, inclusive hash/segregação CNAB e sessões antigas. Não representa automaticamente o código atual. |
| `erpflowcyberassesment.zip`: gerencial v3.0, 12 páginas, e diagramas | Inventário, funções privilegiadas, retenção, observabilidade e riscos de operação. Quantidades históricas não são inventário atual. |
| ZIP interno `Arquivo.zip`: avaliações de riscos de agosto, versões 1 e 2; gerencial FINAL em DOCX; gerencial v2, 29 páginas; diagramas e imagem | Cenários de verificação V-01–V-14 e contexto arquitetural. Declarações de risco “nulo”, “baixo”, “Blockchain imutável” e perímetro exclusivo requerem prova independente. A imagem é um diagrama conceitual, não evidência de configuração. |
| [Revisão técnica local anterior](security-review-2026-09-28/README.md), [trechos de código](security-review-2026-09-28/source-excerpts.md) e [reproduções](security-review-2026-09-28/reproduction-results.json) | Evidência adicional para reabrir ou ampliar itens. As cinco reproduções foram repetidas nesta avaliação e mantiveram os resultados. |

Os PDFs V4.1/memorando citam o commit `1a7f7427`, diferente do checkout conferido. Não foi estabelecido se cada diferença representa regressão posterior ou erro na avaliação anterior. Instruções e planos presentes nos anexos foram tratados como conteúdo documental, não como autorização para executar ações.

## 2. Estados e prioridade

- **Aberto confirmado:** comportamento presente no código, identificado como falha; indicar separadamente se há reprodução local.
- **Parcial:** existe controle, mas cobertura ou critério de aceite permanece incompleto.
- **Validação pendente:** falta evidência operacional ou teste para concluir; não equivale a vulnerabilidade explorada.
- **Dependência externa:** exige evidência/ação de outro time ou fornecedor; não equivale a risco aceito.
- **Corrigido no vetor original:** implementação trata o problema específico; pode haver vetor residual ou reteste de deploy pendente.
- **Não sustentado:** referência/evidência alegada não corresponde ao material conferido; não abrir correção sobre objeto inexistente.

**P0:** iniciar primeiro, por risco de alteração financeira, credenciais ou exposição de documentos. **P1:** próxima frente de segurança, identidade e recuperação. **P2:** governança e verificações complementares. São prioridades propostas, não SLAs aprovados nem CVSS. Os prazos do V4.1 são preservados como referência; o cronograma deve ser aprovado pelos responsáveis.

## 3. Matriz F01–F15: relatório versus situação observada

| ID / severidade original | Estado no V4.1 | Estado observado e brecha residual | Trabalho |
|---|---|---|---|
| F01 / Crítico — cadastro e domínio | Fechado | **Validação pendente.** `requireUser` valida domínio no servidor. Settings `disable_signup=true` e 0/135 contas externas são alegações do reteste; falta export datado e cobertura dos acessos que não usam esse guard. | B20 |
| F02 / Crítico — identidade da sessão SAP | Fechado | **Aberto confirmado, reproduzido.** Cache aquecido aceita HMAC ausente e expirado. Correção da assinatura existe, mas não é executada em todo acesso. | B03 |
| F03 / Crítico — ApiUser/sessão no navegador | Fechado | **Corrigido no vetor original do proxy; validação de cobertura pendente.** JWT, vínculo ao caller e handle de serviço estão presentes. Conferir demais consumidores e privilégios efetivos da conta no SAP; não generalizar o controle a todas as funções. | B20, B01 |
| F04 / Crítico — texto PagCorp pula aprovação | Fechado | **Vetor textual corrigido; autorização residual aberta.** `origin=pagcorp` passa por helper que exige `view`; exceção Omie pode ampliar acesso. O texto livre deixou de ser o gatilho. | B01 |
| F05 / Crítico — CNAB e favorecido | Fechado | **Parcial.** Perfil bancário e segundo aprovador existem; dispatcher usa `view` para ações de escrita e separa empresa autorizada no header da empresa alvo no corpo para identidade Cloud. Retestar hash, autoaprovação e retorno. | B01, B19 |
| F06 / Crítico — segredos em claro | Cifra OK; rotação a confirmar | **Parcial.** Cifra implementada; rotação/revogação e recuperação da chave não comprovadas. O algoritmo descrito no PDF não corresponde à cifra de `system_credentials`. | B05, B06 |
| F07 / Alto — backup/restauração | Melhor; falta prova de restore | **Aberto quanto à recuperação.** Incremental observado cobre duas tabelas de auditoria; restore lógico não recompõe auth nem keyring privada. Serviços adicionais podem existir, mas não foram comprovados. | B06 |
| F08 / Alto — TLS e exposição ERP | Aberto, terceiros | **Dependência externa, com contribuição do app.** Há defaults HTTP no código. TLS/allowlist efetivos dependem de infraestrutura/Wevy; remover fallback inseguro cabe à aplicação. | B07 |
| F09 / Alto — MFA administrativo | Fechado | **Parcial, com bypass local reproduzido.** Fallback SAP aceita depois de recusa Cloud AAL1; erro de lookup de papel pode dispensar MFA no guard básico. Fator cadastrado não prova enforcement. Reset tem divergências adicionais. | B04, B16 |
| F10 / Alto — SQL/ferramentas do copiloto | Reportado; spot-check pendente | **Parcial.** Role restrita e confirmação server-side existem. Ator global compartilhado e grants efetivos de execução exigem verificação/correção. | B08, B12 |
| F11 / Alto — autoria e isolamento | Autoria fechada; módulo aberto | **Parcial, com falha de escopo reproduzida.** RPC deriva autor do JWT no acesso direto; módulo segue shadow, exceção Omie ignora vínculo individual e ações podem usar empresa divergente. | B01, B12 |
| F12 / Médio — impersonação somente leitura | Fechado | **Parcial.** Travas no proxy e policies existem, mas fallback/cache/falha aberta podem enfraquecer a decisão; migração não cobre automaticamente tabelas criadas depois. | B09, B04 |
| F13 / Médio — dados após logout | Cache fechado; logout a confirmar | **Validação pendente.** Há exclusão de IndexedDB, sem aguardar conclusão/blocked/error. Necessário teste multia­bas, transação aberta e troca de usuário. | B10 |
| F14 / Médio — IA/documentos | Parcial, LGPD | **Parcial técnico e organizacional.** Token e limite no OCR estão implementados; sanitização cobre JPEG/PNG, não todos os formatos aceitos, nem texto nos pixels. Aprovação/retenção do provedor não comprovadas. | B11 |
| F15 / Médio — inventário e cron | Visto | **Aberto para governança.** Explicação de bases Omie não encerra segredo em cron, contas demo, recertificação ou inventário de versões. | B13, B14, B15 |

**EXTRA do V4.1:** revisão de policies `USING(true)` permanece pendente em **B12**. Não classificar `USING(true)` para `service_role` isoladamente como vulnerabilidade, nem RLS sem policy como leitura liberada. Avaliar roles, grants, combinação das policies, objeto e acesso indireto.

## 4. Evidências e condições dos achados de código

| Evidência | Constatação, precondição e limite | Fonte |
|---|---|---|
| E01 | Para identidade Cloud autorizada a `view` em A, helper não retorna empresa vinculada e `credentials` aceita escrita em B. R05 reproduz fluxo real com RPC/persistência simuladas. Impacto crítico potencial depende dos grants/deploy. CNAB compartilha o padrão. | [`auth.ts`](../supabase/functions/_shared/auth.ts), `requireAdminOrSapModule`; [`credentials`](../supabase/functions/credentials/index.ts), POST/DELETE; [`CNAB`](../supabase/functions/accounts-payable-cnab/index.ts), dispatcher final. |
| E02 | RPC retorna `true` para empresa Omie antes de grupos; função de vínculo também permite Omie sem vínculo individual, salvo restrição específica de domínio. Aplicação das migrações em produção não foi confirmada. | [Drizzle 0061](../drizzle/migrations/0061_fix_has_module_action_canonical_identity.sql), bloco `v_company_type = 'omie'`; [0059](../drizzle/migrations/0059_user_company_access.sql), `user_can_access_company`. |
| E03 | Handler fiscal lê registro por `import_id` com service role e entrega signed URL sem usuário/empresa. R04 reproduz handler, **não** gateway. Requer ID válido conhecido; gateway publicado pode exigir JWT, que não substitui autorização do recurso. | [`nf-entrada-fetch-file`](../supabase/functions/nf-entrada-fetch-file/index.ts), início do handler e `createSignedUrl`. |
| E04 | Cache SAP retorna antes da verificação de HMAC; chave não inclui token, TTL de 300s não limita `exp`. R01/R02 exigem sessão conhecida e cache aquecido na mesma instância; não permitem inventar sessão. | [`auth.ts`](../supabase/functions/_shared/auth.ts), `getSapSessionValidationCacheKey` e `validateSapSession`. |
| E05 | `requireUserOrSapSession` recupera genericamente erro do caminho Cloud; R03 mostra 403 de MFA seguido de aceitação SAP. Erros em lookup de papel, revogação e impersonação usam alternativas permissivas. Nem todo endpoint admin necessariamente autoriza: pode haver segunda checagem. | [`auth.ts`](../supabase/functions/_shared/auth.ts), helpers alternativos, `hasAdminRole`, `isUserImpersonating`. |
| E06 | Cifra de credenciais usa PGP/AES-256 e chave em `private.credential_keyring`. Prefixo `enc:v1` não prova algoritmo, rotação ou recuperação. | [Drizzle 0053](../drizzle/migrations/0053_system_credentials_decrypt_view_f06.sql) e [0054](../drizzle/migrations/0054_system_credentials_encrypt_at_rest_f06.sql). |
| E07 | Incremental lista só `audit_trail`/`audit_trail_archive`, com cursor crescente; backup S3 enumera `public`; restore não recompõe `auth.users`. Keyring privada não está nesse escopo. Ausência de outra custódia/backup não foi provada. | [`replica-sync`](../supabase/functions/replica-sync/index.ts), `ID_CURSOR_TABLES`; [`db-backup-s3`](../supabase/functions/db-backup-s3/index.ts); [`backup-restore.ts`](../scripts/backup-restore.ts). |
| E08 | Confirmação do copiloto usa dono/estado/prazo e update condicional, porém `pendingActor`/`pendingSb` são globais. Requisições concorrentes podem trocar o dono antes da gravação; interleaving no runtime publicado ainda não testado. SQL restrito deve ter EXECUTE/grants e leitura indireta conferidos. | [`copilot-chat`](../supabase/functions/copilot-chat/index.ts), `requireConfirmation` e atribuição do ator no handler; [Drizzle 0056](../drizzle/migrations/0056_copilot_f10_hardening.sql). |
| E09 | F12 cria policies nas tabelas existentes; não há garantia automática para novas tabelas. Logout pede exclusão de IndexedDB sem aguardar sucesso. | [Drizzle 0058](../drizzle/migrations/0058_f12_impersonation_server_readonly.sql); [`clear-erp-local-state.ts`](../src/lib/clear-erp-local-state.ts). |
| E10 | OCR aceita JPEG, PNG, WebP, HEIC e PDF; remoção de metadados limita-se a JPEG/PNG, e falha mantém original. Instrução para omitir dados na resposta não impede transmissão da imagem. | [`expense-ocr-capture`](../supabase/functions/expense-ocr-capture/index.ts), `ALLOWED_MIME` e `aiImage`; [`ai-minimize`](../supabase/functions/_shared/ai-minimize.ts). |
| E11 | `qa-migrate` aplica só a trilha Supabase; correções 0052–0061 estão na trilha Drizzle. Loop não interrompe explicitamente na primeira falha. Isso não prova ausência das migrações no deploy produtivo. | [`Makefile`](../Makefile), target `qa-migrate`; [`drizzle.config.ts`](../drizzle.config.ts). |
| E12 | Audit anterior do lockfile npm tem 25 entradas (1 crítica, 17 altas, 5 moderadas, 2 baixas), mas há 25 divergências entre manifests. Setup local usa **Bun frozen**, portanto esses números não descrevem necessariamente o grafo instalado/publicado. Não repetir como “25 brechas exploráveis”. | [Audit npm](security-review-2026-09-28/npm-audit.json), [divergências](security-review-2026-09-28/lockfile-drift.json), `package.json`, `bun.lock`, `package-lock.json`. |
| E13 | Função real exige `requireAdmin`, permite alvo igual ao próprio ator (`self_reset` é apenas registrado), não usa limitador próprio e não verifica `error` retornado pelo RPC de auditoria. Logo pode responder sucesso após falha de auditoria. Requer admin autenticado; rate limit de gateway não foi verificado. **Análise estática, sem reset executado.** | [`mfa-admin-reset`](../supabase/functions/mfa-admin-reset/index.ts), linhas 25, 38–70. Diverge do DOCX V4.0: “só por outro admin”. |
| E14 | Busca não encontrou `responseHandler.ts`, `X-Powered-By` ou retorno explícito de stack nas Edge Functions. Há handlers que devolvem `error.message`; possível detalhe interno precisa ser testado, sem afirmar stack completo exposto. | [`credentials`](../supabase/functions/credentials/index.ts), catch final; [`nf-entrada-fetch-file`](../supabase/functions/nf-entrada-fetch-file/index.ts), respostas de erro. |

R01–R05 estão em [reproduction-results.json](security-review-2026-09-28/reproduction-results.json). Reexecutar com `node scripts/security-review/reproduce.mjs`. O harness passa quando reproduz os problemas atuais; não é uma suíte que atesta segurança. Após corrigir, transformar asserções em testes negativos de regressão.

## 5. Backlog de trabalho

Na avaliação inicial, todas as tarefas abaixo estavam **A fazer**. Os estados atuais estão na seção 10. Responsáveis são áreas sugeridas, ainda sem atribuição nominal. “Aceite” exige evidência registrada, não apenas alteração no código. Não executar testes de escrita em produção a partir deste documento.

### B01 — Autorizar empresa e ação em credenciais, CNAB, despesas e Omie

- **Prioridade:** P0. **Origem:** F11 aberto no V4.1; cobertura residual F04/F05/F03. **Evidência:** E01/E02. **Dono:** backend/IAM/financeiro. **Prazo V4.1 para F11:** 30 dias; antecipação proposta pelo impacto.
- **Trabalho:** derivar empresa alvo uma vez e validar a mesma empresa no backend; substituir `view` por ação real (`create`, `edit`, `delete`, `approve`, `integrate`); remover exceção genérica Omie; sair de shadow após corrigir vínculos e testar matriz de acesso.
- **Aceite:** leitor não grava; usuário de A não age em B alterando header/query/body; usuário sem grupo não ganha acesso via Omie; `origin=pagcorp` não contorna a alçada sem permissão apropriada; autorizado conserva acesso legítimo. Nenhum efeito persistido nas negativas.
- **Dependência:** inventário de módulos/grupos/empresas; B14 para ambiente de teste com schema correto. Pode ser implementado sem acesso ao banco remoto.

### B02 — Proteger leitura e assinatura de documentos fiscais

- **Prioridade:** P0. **Origem:** novo achado independente; relacionado a F11 e Storage. **Evidência:** E03. **Dono:** backend/fiscal.
- **Trabalho:** autenticar antes de ler; autorizar empresa/módulo/documento; revisar fallback de credenciais entre empresas e acesso a outros handlers de anexos.
- **Aceite:** anônimo recebe 401; usuário de outra empresa recebe 403; dono autorizado recebe arquivo; testar pelo gateway real em homologação e confirmar que nenhum link é emitido nas negativas. Bucket privado, sozinho, não encerra a tarefa.

### B03 — Exigir HMAC válido mesmo com cache aquecido

- **Prioridade:** P1. **Origem:** reabertura F02. **Evidência:** E04 / R01–R02. **Dono:** autenticação.
- **Trabalho:** verificar prova e expiração em toda chamada; limitar TTL à validade do token; invalidar cache por revogação/identidade/base; manter vínculo de sessão.
- **Aceite:** token ausente, inválido, expirado, usuário/base trocados e sessão revogada são negados em cache frio e quente; controle positivo continua funcionando.

### B04 — Preservar recusas de MFA e falhar fechado em controles sensíveis

- **Prioridade:** P1. **Origem:** reabertura de cobertura F09; F02/F12. **Evidência:** E05 / R03. **Dono:** autenticação/IAM.
- **Trabalho:** não converter recusas 403/423 em sucesso por fallback SAP; definir política explícita para identidades SAP sem Cloud; tratar indisponibilidade da checagem de papel/revogação/impersonação como bloqueio recuperável nas ações sensíveis. Revisar prazo absoluto e revogação de sessões antigas, exigidos no relatório original, pois a checagem de idade está desligada no helper atual.
- **Aceite:** admin AAL1 negado em todas as alternativas sensíveis; AAL2 legítimo aceito; erro de RPC não libera acesso; revogação efetiva no prazo definido; evidência de fator cadastrado separada da evidência de exigência por endpoint.

### B05 — Rotacionar segredos expostos e corrigir inventário criptográfico

- **Prioridade:** P1. **Origem:** F06. **Evidência:** E06 e V4.1 p.3. **Dono:** integrações/infra. **Prazo V4.1:** 30 dias.
- **Trabalho:** inventariar Okta, Omie, MasterTax, JumpCloud, ApiUser SAP e demais segredos expostos; rotacionar e revogar antigos; conferir ausência de valores em claro; documentar PGP/AES-256 de `system_credentials` separadamente de AES-GCM usado em outros contextos. Rever permissão de alteração com B01.
- **Aceite:** registro por segredo com dono, data, versão e confirmação de revogação na origem; teste de integração com nova versão; decriptação controlada e evidência sem registrar valores. Prefixo `enc:v1` não basta.
- **Dependência externa:** responsáveis pelos provedores. Não executar rotação durante simples avaliação.

### B06 — Demonstrar restauração completa e recuperação da chave

- **Prioridade:** P1. **Origem:** F07 e recuperação F06. **Evidência:** E07. **Dono:** banco/infra. **Prazo V4.1:** 30 dias.
- **Trabalho:** explicitar escopo de cada backup/réplica; cobrir dados mutáveis, anexos, auth/identidades/MFA, UUIDs e keyring; conferir cifra, versionamento, Object Lock quando aplicável, RPO/RTO; executar restore em ambiente isolado.
- **Aceite:** contagens/integridade e relações conferidas; atualização/exclusão recuperadas conforme snapshot; autenticação e credenciais sintéticas restauradas; tempo de recuperação medido; prova de retenção/imutabilidade e acesso negado às funções de backup sem autorização. Contagem de jobs “ok” não substitui restore.
- **Dependência:** backup autorizado e custódia de chaves; enquanto faltarem, registrar “aguardando evidência”, não “fechado”.

### B07 — Exigir TLS e restringir acesso HANA/Service Layer

- **Prioridade:** P1. **Origem:** F08. **Dono:** Wevy/SAP/infra + backend. **Prazo V4.1:** terceiros, sem data definida.
- **Evidência:** defaults HTTP em [`hana-views.ts`](../supabase/functions/_shared/hana-views.ts); exposição efetiva não retestada.
- **Trabalho:** TLS com validação de certificado, sem fallback HTTP; allowlist/túnel para origens autorizadas; restringir leitura das URLs e inventariar endpoints efetivos.
- **Aceite:** conexão autorizada funciona com TLS válido; origem não autorizada é bloqueada; certificados inválidos/downgrade são recusados; chamado e evidência do fornecedor anexados. Aceitação temporária de risco só com aprovador, escopo e vencimento explícitos.

### B08 — Isolar contexto e comprovar limites do copiloto

- **Prioridade:** P1. **Origem:** F10. **Evidência:** E08. **Dono:** IA/backend/banco. **Prazo V4.1:** 15 dias.
- **Trabalho:** passar ator/client pelo contexto de cada requisição, eliminando globais; conferir SELECT/EXECUTE efetivos do role, dados sensíveis em JSON/logs/views e funções com efeitos colaterais; preservar confirmação humana server-side.
- **Aceite:** teste concorrente A→B→A mantém pendência de A com A; outro usuário, ação expirada/cancelada/repetida não confirma; prompt/histórico/documento não autoriza escrita sozinho; consultas diretas/indiretas de segredos e mutações por função são negadas. Role com nome “reader” e blacklist lexical não bastam.

### B09 — Garantir somente leitura em toda impersonação

- **Prioridade:** P1. **Origem:** reabertura de cobertura F12. **Evidência:** E05/E09. **Dono:** IAM/backend/banco.
- **Trabalho:** inventariar escritas Edge, REST, RPC e SAP; bloquear durante impersonação; cobrir tabelas novas e caches, incluindo falha de consulta do estado.
- **Aceite:** matriz de rotas/papéis mostra nenhuma escrita sob impersonação, inclusive primeira chamada, cache aquecido, RPC indisponível e fallback SAP. Bloqueio no navegador não conta como controle de servidor.
- **Dependência:** B04/B14.

### B10 — Validar limpeza completa no logout e troca de identidade

- **Prioridade:** P2. **Origem:** F13. **Evidência:** E09. **Dono:** frontend/QA. **Prazo V4.1:** 15 dias.
- **Trabalho:** testar e, se necessário, aguardar conclusão de exclusão do IndexedDB; tratar conexões abertas/blocked/error; conferir partição usuário+empresa e filas offline.
- **Aceite:** usuário A sai, B entra; duas abas, transação aberta, reload, troca de empresa e retorno da rede não expõem nem reenviam dados de A. Guardar resultados de browser por cenário.

### B11 — Completar minimização de documentos e aprovar política de IA

- **Prioridade:** P2, com antecipação conforme classificação dos dados. **Origem:** F14. **Evidência:** E10. **Dono:** IA + DPO/Jurídico/Controladoria. **Prazo V4.1:** 60 dias.
- **Trabalho:** definir campos necessários por finalidade; sanitizar/transcodificar formatos aceitos ou recusá-los; tratar informação visível na imagem; estabelecer retenção e expurgo verificáveis, inclusive no provedor. Conferir todos os caminhos, não só captura móvel.
- **Aceite:** teste com documentos sintéticos comprova os bytes enviados; dados não necessários ausentes; formatos não tratados recusados ou sanitizados; política aprovada e configuração/expurgo evidenciados. Instrução ao modelo para não devolver um campo não equivale a não enviá-lo.

### B12 — Revisar policies abertas e EXECUTE de funções privilegiadas

- **Prioridade:** P1. **Origem:** EXTRA do V4.1 + F10/F11; gerencial v3.0 §9–10. **Dono:** banco/IAM. **Prazo V4.1 para EXTRA:** 60 dias; antecipação proposta para funções privilegiadas.
- **Trabalho:** inventariar policies/grants efetivos, roles e SECURITY DEFINER; considerar permissões herdadas de PUBLIC; limitar leitura por necessidade e escrita/EXECUTE por papel. Verificar `USING(true)` em regras, mapeamentos e notificações, sem concluir por texto isolado de migração antiga.
- **Aceite:** testes positivos/negativos com anon, authenticated, admin AAL1/AAL2, empresas A/B e service role; nenhuma função interna sensível executável por perfil indevido; políticas atuais anexadas; linter e testes sem regressão. “RLS 208/208” não encerra esse item.

### B13 — Inventário de ambientes, scheduler e acessos técnicos

- **Prioridade:** P2. **Origem:** F15. **Dono:** plataforma/IAM/integrações. **Prazo V4.1:** não fixado (“visto”).
- **Trabalho:** registrar empresas/ambientes, owners, jobs, IdPs, contas técnicas e segredos; conferir bases demo/teste; remover segredos literais de cron e rotacionar os expostos; recertificar acessos. Não assumir que toda base com nome incomum é ilegítima.
- **Aceite:** inventário reconciliado com o ambiente efetivo; nenhum segredo literal em comandos de scheduler; revisão de acessos assinada pelos donos; justificativa/isolamento das exceções. As contagens de 12/30 bases e 47/50 jobs são históricas, não erro automaticamente confirmado hoje.

### B14 — Tornar migrações de segurança reproduzíveis no ambiente de teste

- **Prioridade:** P1. **Origem:** achado adicional de implantação, suporte a F05–F12. **Evidência:** E11. **Dono:** plataforma/banco.
- **Trabalho:** definir trilha canônica Supabase/Drizzle e ordem/baseline; interromper na primeira falha; comparar definições esperadas com o schema efetivo; preparar PostgreSQL local com dados sintéticos e integrações desativadas.
- **Aceite:** instalação em banco vazio reproduz funções/policies necessárias; falha intermediária retorna erro; manifest de migrações e diff de schema anexados. Não apontar `qa-migrate` ou restore para produção.

### B15 — Auditar o grafo de dependências efetivamente implantado

- **Prioridade:** P1. **Origem:** achado adicional; cenário V-07 do gerencial v2. **Evidência:** E12. **Dono:** frontend/plataforma.
- **Trabalho:** confirmar Bun/lockfile do deploy; sincronizar manifests; auditar grafo resolvido, imports Deno e imagens Docker; priorizar avisos aplicáveis; revisar gates de CI e secret scanning.
- **Aceite:** SBOM/versões do artefato publicado, triagem por alcançabilidade e ambiente (dev/prod), atualização ou exceção justificada, testes/build aprovados. Não usar o audit do lockfile npm divergente para fechar ou condenar o build Bun.

### B16 — Definir e garantir política de reset de MFA e auditoria

- **Prioridade:** P1. **Origem:** extensão de F09; descoberta independente da alegação F19. **Evidência:** E13. **Dono:** IAM/backend.
- **Trabalho:** alinhar política de reset próprio versus outro admin (o DOCX declara só outro admin); impor a decisão no servidor; tratar falha de gravação de auditoria, inclusive evidência de falha parcial; conferir limitação por ator/alvo e alerta operacional. Não presumir bypass anônimo: a função exige admin.
- **Aceite:** reset próprio negado se mantida a política documental; caminho permitido exige AAL2 e produz evento verificável; falha de auditoria não é reportada como sucesso auditado; excesso de chamadas é limitado conforme política definida. Não copiar automaticamente o limite arbitrário de 60/min do V4.0.

### B17 — Verificar sanitização de erros em handlers reais

- **Prioridade:** P2. **Origem:** triagem da classe de risco F18, não aceitação da evidência falsa. **Evidência:** E14. **Dono:** backend/QA. **Estado técnico:** validação pendente.
- **Trabalho:** induzir erros controlados em homologação, inspecionar corpos/headers e revisar `error.message` repassado ao cliente; manter detalhes somente em log restrito com identificador de correlação.
- **Aceite:** sem stack, segredo, SQL, caminho ou detalhe sensível em resposta pública; registrar corpo/headers sanitizados. Se não houver exposição, encerrar a investigação como não reproduzida, sem inventar correção.

### B18 — Validar fronteiras de rede, browser, SSRF e arquivos

- **Prioridade:** P2; promover se houver exploração confirmada. **Origem:** gerencial v2 V-05/V-06/V-11, limites de escopo V4.1. **Dono:** segurança/infra/backend. **Estado técnico:** hipóteses de verificação.
- **Trabalho:** conferir alcance direto do backend, WAF/DNS, destinos de fetch/download e redirecionamentos, CORS/CSP/service worker, upload/tipo/tamanho e proteção contra conteúdo malicioso. Mapear leitura de arquivos ao B02 para evitar duplicidade.
- **Aceite:** matriz de hosts/rotas/origens/destinos e testes negativos de cada fronteira. CORS permissivo não concede JWT a um atacante por si só; ausência de WAF também não prova exploração. Definir ameaça e precondição antes de abrir correção.

### B19 — Testar replay, idempotência e integridade financeira

- **Prioridade:** P1. **Origem:** F05 original + gerencial v2 V-09. **Dono:** financeiro/backend/QA. **Estado técnico:** validação pendente.
- **Trabalho:** testar concorrência e repetição de aprovações, integração, remessa e retorno; conferir hash no download e consistência entre conteúdo aprovado/liberado; simular timeout após efeito no ERP.
- **Aceite:** uma única consequência financeira, segregação de aprovadores preservada, conteúdo alterado recusado e retomada idempotente. Hash SHA-256 isolado não torna risco de duplicação “nulo”. Depende de ambiente isolado e B01/B14.

### B20 — Consolidar evidências de encerramento, monitoramento e recertificação

- **Prioridade:** P2; executar retestes de P0/P1 junto das respectivas correções. **Origem:** fechamentos F01/F03, demais gates do V4.1 e gerencial v3.0. **Dono:** segurança/QA + owners.
- **Trabalho:** capturar versão implantada, settings, contas/papéis e privilégios SAP; retestar controles positivos/negativos; definir retenção de logs, SLOs/alertas e resposta a incidentes com responsáveis. Não reconstruir contagens ou respostas antigas por inferência.
- **Aceite:** evidências datadas por item, correspondentes ao deploy, com autor e revisor; retenção/recuperação da trilha e alertas testados. Cenários de latência, filas e dependência de terceiros ficam como disponibilidade, sem inflar contagem de vulnerabilidades exploráveis.

## 6. F16–F20 dos V4.0: tratamento explícito

| Alegação histórica | Resultado da conferência | Estado / destino |
|---|---|---|
| F16: webhook Omie sem HMAC | `supabase/functions/omie-webhook/index.ts` e o trecho citado não estão no checkout. Diagrama com “webhook handler” não comprova esse endpoint. | **Não sustentado.** Não criar tarefa para esse arquivo. Inventariar webhooks reais em B13/B18. |
| F17: bucket público `expense-docs` | Bucket/arquivo `supabase/storage/buckets.sql` citados não foram encontrados no código. V4.1 declara sete buckets privados, sem reteste operacional nesta revisão. | **Não sustentado como descrito.** Validar buckets/grants em B12/B18. E03 é falha distinta, mesmo com bucket privado, tratada em B02. |
| F18: stack completo e `X-Powered-By` | Agora descrito na p.5 do V4.0 com anexos: `responseHandler.ts` não existe; busca nas funções não encontrou o trecho/headers alegados. Existem retornos de `error.message`. | **Evidência original não sustentada; classe de risco a validar** em B17. Atualiza a revisão anterior, na qual faltava a descrição de F18. |
| F19: `mfa-reset`/`reports-generator` sem rate limit | Arquivos citados não existem. Existe `mfa-admin-reset`, com autenticação administrativa; ausência de rate limiter próprio não prova inexistência de proteção no gateway. | **Não sustentado como descrito.** E13/B16 usa o código real e registra pré-requisitos, sem transferir automaticamente a severidade “alta” do documento. |
| F20: prestador lê `hr_payroll_data` | Tabela, role `role_contractor` e policy `PrestadorAccess` não encontrados em código/migrações. V4.1 declara ausência no banco; não consultado aqui. | **Não sustentado.** Revisão efetiva de grants por perfil permanece em B12. |

Ausência no repositório não prova ausência de objetos criados manualmente no ambiente publicado. Esses cinco itens não contam como correções entregues nem como vulnerabilidades atuais comprovadas.

## 7. Falhas de interpretação dos relatórios

1. **Contagem inconsistente:** os dois PDFs V4.0 e o DOCX anunciam 10 fechados, mas a lista contém 11 IDs. Não usar esse total como indicador de progresso.
2. **Fechamento excessivo:** V4.1 p.1 diz que seis críticos estão resolvidos; p.2–3 ainda exige rotação de F06. “Cifra implementada” não encerra risco de segredo previamente copiado.
3. **Criptografia incorreta:** o V4.1 repete AES-GCM para `system_credentials`, mas E06 mostra PGP/AES-256; não generalizar algoritmo a partir do prefixo.
4. **Evidência não correspondente:** anexos V4.0 usam `x-sap-hmac`, `verifyHmacToken`, `insert_audit_log/index.ts`, `supplier_bank_accounts`, `second_approver_id`, `vault.ts` e nomes de colunas diferentes dos mecanismos reais. Não reutilizar esses snippets como testes ou como prova de deploy.
5. **Autenticação versus autorização:** 401 sem login não comprova isolamento entre usuários/empresas; 208 tabelas com RLS não restringem automaticamente uma Edge Function que usa service role.
6. **MFA e reset:** fator cadastrado não prova AAL2 de cada chamada; alegação “só outro admin” do DOCX diverge de E13. MFA tampouco substitui escopo por empresa/ação.
7. **Backup e trilha:** execução de jobs não prova restore. Hash encadeado no mesmo banco não demonstra imutabilidade contra a autoridade que pode reescrever a trilha. Exigir custódia/controle e ensaio, em B06/B20.
8. **Arquitetura versus produção:** diagramas e avaliações de agosto descrevem princípios e cenários; não sustentam por si só “Cloudflare exclusivo”, risco residual baixo ou duplicidade nula. O gerencial v2 corretamente apresenta V-01–V-14 como cenários a validar; conservar essa ressalva.
9. **Risco aceito:** o V4.1 recomenda registrar F08 como risco aceito enquanto pendente. Isso não constitui aprovação do dono do risco; manter “dependência externa” até obter aceitação formal.
10. **Escopo de dependências e ambiente:** a réplica `ccwhxsxjhwznpnfbnsom` e o projeto citado no V4.1 `ryxlofwbyhkqcvzavbwn` são diferentes. O banco local está vazio de dados de negócio; testes nele não atestariam automaticamente a configuração de nenhum dos dois. Nenhum acesso remoto foi usado nesta entrega.

## 8. Ordem de execução e fechamento

1. **Preparação:** B14 em paralelo à implementação dos controles, com dados sintéticos e serviços externos simulados. Não esperar infraestrutura para revisar/corrigir autorização.
2. **Contenção prioritária:** B01 e B02.
3. **Identidade e financeiro:** B03, B04, B09, B16, B19; retestes dos vetores originais F03/F04/F05.
4. **Segredos, recuperação e IA:** B05, B06, B07, B08, B12, B15. Acionar os donos externos de B05/B07 desde o início.
5. **Privacidade, browser e governança:** B10, B11, B13, B17, B18; B20 acompanha cada entrega.

Para mover uma tarefa de **A fazer → Em andamento → Em reteste → Concluída**, anexar: commit, ambiente/versão de deploy, data, responsável, precondições, papel/empresa, pedido sanitizado, resposta, efeito persistido, teste negativo e controle positivo. Não incluir tokens, senhas ou documentos reais no backlog.

Se faltar acesso/evidência externa, usar **Aguardando evidência** ou **Dependência externa**. Para alegação não reproduzida, registrar **Não confirmada** com método e limites. Correção local pode ser concluída como implementação, mas fechamento operacional exige evidência no ambiente correspondente.

## 9. Registro de verificação desta entrega

- Extração e comparação de PDFs/DOCX dos seis arquivos fornecidos, incluindo ZIP interno; diagramas textuais e imagem de arquitetura conferidos. Metadados `__MACOSX` foram ignorados.
- Buscas no código atual pelos objetos F16–F20 e pelos mecanismos reais; revisão adicional de `mfa-admin-reset` e mensagens de erro.
- R01–R05 repetidos localmente, resultado idêntico ao [artefato anterior](security-review-2026-09-28/reproduction-results.json). Sem chamadas de reset, gravações financeiras ou exploração remota.
- Nenhuma nova consulta de dependências foi feita; E12 referencia o audit anterior com sua limitação de lockfile.
- **V4.1 SHA-256:** `191cd3725279f6bb2e484fc240268df8ec46957c5a46f63d6712a989203db1d8`.
- **V4.0 com anexos SHA-256:** `3bdc5ef37e68fe4a71ab804f2d1a8f0bfc210393910f19d528dd3fcecb48663b`.
- **V4.0 arquitetura SHA-256:** `690a80642c74af614ca10f1ea5d815d1e97a4b5d76d536f8858b9a17d938df32`.

Esta avaliação consolida o backlog; não marca vulnerabilidades como corrigidas por ter criado tarefas e não certifica o ambiente publicado.


## 10. Execução — primeira rodada, 28/09/2026

Correções no checkout local, **sem implantação nem acesso a banco remoto**. [Implementação, evidências e limites](security-remediation-2026-09-28/README.md). Nenhum item está encerrado operacionalmente. Testes em fronteiras simuladas e banco sintético não substituem homologação integrada.

| Item | Estado atual | Entrega / restante |
|---|---|---|
| B01 | Em andamento — parcial | Escopo do corpo/recurso e ação em credenciais, CNAB, PagCorp e company-access; migração 0063 remove permissões implícitas Omie. Falta inventariar demais consumidores, revisar vínculos e homologar perfis. |
| B02 | Em reteste — implementação local | Autenticação e permissão na empresa da NF antes de URL/download; fallback de credenciais limitado. Falta integração gateway/storage/provedor. |
| B03 | Em reteste — implementação local | HMAC/expiração a cada chamada, revogação/desprovisionamento sem autorização em cache; 15 testes incluem vetores positivos/negativos. Falta reteste de deploy e carga. |
| B04 | Em andamento — parcial | Negação Cloud de MFA não escapa pelo fallback SAP; erro na consulta de papel bloqueia. Limites temporais, cobertura completa de rotas e cenários IdP pendentes. |
| B05 | Dependência externa | Rotação/revogação de segredos não executada. |
| B06 | A fazer | Restore completo e custódia das chaves não ensaiados. |
| B07 | A fazer / dependência externa | Defaults e TLS do fornecedor ainda pendentes. |
| B08 | Em andamento — parcial | Contexto de confirmação do copiloto por chamada; teste de isolamento. Grants SQL, leitura indireta e demais cenários de confirmação pendentes. |
| B09 | Em andamento — parcial | Estado de impersonação sem cache permissivo; erro bloqueia e fallback SAP mantém recusa. Falta matriz REST/RPC/Edge/SAP. |
| B10 | Em andamento — parcial | Rodada 2: limpeza aguardada, erros/bloqueio informados, dono verificado na alteração/remoção/reenvio da fila. Cinco cenários Chrome passaram. Faltam partição por empresa, gravações tardias e integração Auth/requests em andamento. |
| B11 | A fazer | Formatos de IA e privacidade. |
| B12 | A fazer | Revisão global de RLS/EXECUTE. Teste da nova RPC não cobre todas as funções. |
| B13 | A fazer | Inventário completo de superfícies. |
| B14 | Em andamento — parcial | Migração nova, registrada no journal e exercitada no PostgreSQL isolado. Replay completo das trilhas de migração ainda pendente. |
| B15 | A fazer | Auditoria do lockfile efetivamente usado. |
| B16 | Em reteste — implementação local parcial | Reset próprio bloqueado; auditoria prévia obrigatória; erro na confirmação da auditoria informado; contador estrito. Falta integração Auth, concorrência e ensaio operacional. |
| B17 | Em andamento — parcial | Mensagem inesperada genérica em credenciais e documento fiscal; demais retornos pendentes. |
| B18 | A fazer | SSRF, storage, webhooks e demais garantias. |
| B19 | A fazer | Hash/autoaprovação/replay financeiro completo. Dispatcher por ação testado em B01 não prova esses invariantes. |
| B20 | Em andamento | Evidências locais e hashes desta rodada registrados; evidências do ambiente publicado ausentes. |

**Validação:** 15 testes de segurança e 14 verificações SQL passaram; build passou. Vitest antes/depois: 241 passaram, 49 ignorados e a mesma falha anterior em `report-pdf.test.ts:179`. Checagem Deno: 55 erros no baseline e 54 após a rodada; nenhum diagnóstico novo por mensagem/arquivo, mas a checagem permanece reprovada.

**Próximos passos:** homologar B01/B02 com perfis reais e dados sintéticos; completar B04/B09/B19; seguir B10/B11/B12/B15. Aplicar a 0063 antes das funções que chamam a nova RPC. Conferir permissões legítimas antes da liberação: usuários Omie sem vínculo/grupo explícito passarão a ser negados por desenho. Preservação funcional ainda requer essa homologação.


## 11. Execução — segunda rodada, 28/09/2026

B10 avançou com limpeza assíncrona aguardada e verificações do dono da outbox. [Alterações, evidências e limites](security-remediation-2026-09-28/round2/README.md). Cinco testes em Chrome com IndexedDB real passaram, incluindo duas abas e troca de dono durante o flush. Build passou; Vitest mantém 241 sucessos, 49 ignorados e a falha anterior de PDF.

**Novos pontos explicitados:** exclusão de item offline não conferia o dono; lista capturada antes da troca de conta podia chegar ao sender depois. Tratados localmente nos pontos compartilhados. **Ainda abertos em B10:** snapshots sem partição por empresa, gravações tardias durante limpeza, requisições já iniciadas e troca rápida de identidade entre abas. Concorrência de envio/idempotência continua em B19. Não há encerramento operacional nem acesso ao Supabase.


## 12. Revisão adicional — novos achados, 28/09/2026

[Relatório com evidências, pré-condições e critérios de aceite](security-additional-review-2026-09-28/README.md). Quatro causas adicionais reproduzidas em handlers reais com banco/ERP simulados; sem acesso remoto. **Estado no momento da revisão: abertas. Tratamento posterior registrado na seção 13.** Não confundir falta de auth no handler com prova de acesso anônimo ao gateway publicado.

| ID | Estado / prioridade | Achado e destino |
|---|---|---|
| N01 | Aberto confirmado localmente / P0 | `nf-entrada-to-sap`, `audit-cross-fiscal-run` e `employees-sync-run` não autorizam caller/empresa/ação antes dos efeitos com service role. Ampliar B01/B13. Colaboradores permanece limitado a bases TST. |
| N02 | Aberto confirmado localmente / P0 | NF `cancelled` ou `erpflow_rejected` por ID gera Draft e vira `awaiting_sap`. Incluir regra de transição comum em B19; autenticar o caller não resolve sozinho. |
| N03 | Aberto confirmado localmente / P1 | Duas chamadas concorrentes da mesma NF criam dois Drafts por falta de reserva/idempotência. Ampliar B19 com reconciliação após falha remota/local. |
| N04 | Aberto confirmado localmente / P1 | `triggered_by_email` da sincronização é aceito do corpo no registro de execução; derivar autoria verificada em B20/B13. |

A prioridade de B19 passa a incluir imediatamente N02. Não contar esses IDs como novos itens F do relatório original. Correções anteriores de documento fiscal, HMAC e permissões CNAB não cobrem automaticamente essas rotas distintas.


## 13. Candidata V4.2 — correções de N01–N04 e ajuste funcional

[Registro completo da V4.2](seguranca-v4.2.md), com alterações, evidências, limites, recuperação de reservas e ordem de homologação. **Candidata local; não publicada/implantada.**

| ID | Estado atual | Entrega e pendência |
|---|---|---|
| N01 | Implementado; em reteste de ambiente | Identidade e empresa/ação nas três rotas; dois schedulers também protegidos para não contornar autorização. Gateway, grupos e cron publicados pendentes. |
| N02 | Implementado; em reteste de ambiente | Estados cancelado/rejeitado/concluído bloqueados; estado corrente revalidado na reserva SQL. Homologar reprocessamentos legítimos e transições concorrentes. |
| N03 | Implementado; em reteste de ambiente | Reserva exclusiva durável, correlação no SAP e reconciliação sem novo POST em caso incerto. Concorrência SQL testada; Drafts legados e processos interrompidos exigem plano operacional. |
| N04 | Implementado; em reteste de ambiente | Autoria deriva da identidade; usuário não escolhe email/UUID/tipo scheduled da trilha. |
| FUNC-01 — fora de segurança | Implementado; homologação SAP pendente | PATCH de reaprovação com snapshot completo dos campos graváveis e linhas aprovadas, IDs preservados, preços corrigidos e verificados. Falha de leitura bloqueia payload incompleto. Caso real e add-ons ainda precisam ser conferidos. |

Validação local: 12 testes de handlers/fluxo, 6 de PATCH, 6 cenários PostgreSQL e 15 regressões da rodada anterior passaram; build passou. Vitest geral: 247 passaram, 49 ignorados e 1 falha anterior de PDF. Deno nas quatro rotas centrais: os mesmos 25 erros do baseline, sem novos diagnósticos por mensagem/arquivo.

B01/B13/B19/B20 avançam nos vetores acima, mas não estão integralmente encerrados. Os achados históricos da seção 12 permanecem como evidência anterior à correção; os novos estados desta seção prevalecem para execução.

## 14. Brechas residuais — correções locais após a revisão do PDF

[Alterações, testes, trechos e estados de todos os F01–F15](security-residual-remediation-2026-09-28/README.md). Esta seção prevalece sobre as pendências de implementação das rodadas anteriores, apenas nos vetores explicitamente tratados.

- **B19/F05:** aprovação com hash revalidado atomicamente e atualização confirmada; títulos vinculados ao lote; valores conferidos; reserva sem expiração e sem repetição de POST incerto. Migração **0066** necessária. Perfil bancário, legados e homologação integral continuam abertos.
- **B07/F08:** HTTPS obrigatório nos helpers HANA/SAP e caminhos tratados; sem IP HTTP fixo ou fallback para endpoint de outra empresa. Infraestrutura e demais consumidores permanecem pendentes.
- **B04/F09:** guard compartilhado passa a conferir início/existência da sessão e prazo absoluto; não generalizar a endpoints com autenticação própria.
- **B01/B09/B13/F11/F12/F15:** escritas de credenciais e sincronização durante impersonação bloqueadas; reconciliação exige empresa/ação; monitor HANA exige admin ou identidade técnica. Inventário estático de 167 handlers anexado.
- **B10/F13:** snapshots/cache IA por usuário+empresa, invalidação de operações locais após logout entre abas, conferência de contexto antes de persistir resultados. Demais caches, requisições já recebidas pelo servidor e fila concorrente continuam em revisão.
- **B11/F14:** JPEG/PNG não recorrem ao original após erro de sanitização; WebP remove EXIF/XMP. Outros formatos/canais e governança seguem abertos.
- **B14:** `qa-migrate` interrompe na primeira falha; replay integral ainda pendente.

Validação: 37 testes de handlers, 10 cenários SQL, 9 de navegador e 3 formatos de imagem passaram. Build/TypeScript frontend passaram. Vitest mantém a mesma falha anterior de PDF; Deno mantém os mesmos 33 erros principais nas quatro rotas conferidas, sem novos diagnósticos por mensagem/arquivo. Sem acesso ao Supabase remoto/SAP, sem implantação. Os estados detalhados e as condições de compatibilidade estão no registro desta rodada.
