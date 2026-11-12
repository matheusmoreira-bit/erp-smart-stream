# Roadmap — Melhorias de segurança (pentest)

- [x] HANA API — rollback solicitado 12/11 17:52 UTC: cinco apontamentos restaurados exatamente do backup para 189.20.156.34:8001; leitura independente confirmou restored_exactly=true nos cinco registros. Caminho /data/, bases de teste, credenciais, permissões e validações preservados. Conectividade não retestada nesta solicitação; recuperação das consultas permanece pendente externa.

- [x] Contingência HANA 12/11: somente 187.111.23.22:8001 incluído na exceção HTTP; quatro testes passaram (porta/IP distintos e credenciais/query/fragmento continuam rejeitados), build OK, 19 funções HANA publicadas. Teste público sem credenciais recebeu HTTP 404 em 427 ms; não comprova consulta HANA. Alterados secure-transport.ts, secure-transport.test.ts, AGENTS.md e roadmap.md; autorização registrada em memória. Revisão de segurança: validações locais OK, permissões/RLS/auth não alteradas; HTTP sem criptografia é risco explicitamente autorizado, demais itens globais não revalidados.
- [x] Contingência HANA: apontamento posteriormente realizado nas quatro empresas e revertido a pedido do usuário em 12/11 17:52 UTC; consulta autenticada não comprovada, sem bypass de MFA.

- [x] Reatribuição individual confirmada por leitura de volta: #B08DCB1A → Marco Tulio (nível 2, Open Gaming); #868BF55F → Ketlhenn Monteiro (nível 1, ANA). Ambos pendentes, regras e níveis preservados, sem segmentos, troca condicionada aos valores anteriores e registrada em audit_log; permissões e código intactos.

- [x] Assistente: busca corrigida em copilot-chat/index.ts e expense-detail.ts; itens ordenados por created_at e anexos file_name/file_size, falhas das quatro leituras propagadas sem falso resultado vazio. Sete testes em expense-detail.test.ts passaram, build OK; somente copilot-chat publicada. AGENTS.md atualizado; nenhum pedido, permissão ou validação alterado.
- [ ] Assistente: validação ponta a ponta autenticada permanece bloqueada; em 12/11 após 13:58 UTC, sessão injetada restaurada no navegador em /backoffice/copiloto mostrou Acesso negado e chamada à função publicada retornou HTTP 403 exigindo segundo fator, antes de consultar o pedido 9463. A sessão --self também havia retornado 403. GO para correção testada; NO-GO para confirmação do fluxo real até sessão com MFA verificável nas ferramentas; nenhum código, pedido, permissão ou validação de segurança alterado nesta verificação.

- [ ] PagCorp/Cactus: restabelecer consulta de transações. Logs de 11/11 às 18:52–19:00 UTC confirmam autenticação de cliente aceita e login PagCorp recusado (HTTP 400, corpo Forbidden/403); mesma configuração teve consulta bem-sucedida em 01/10, sem alteração posterior nas credenciais. Reproduzido em 11/11 após 19:11 UTC por consulta GET autenticada com a sessão disponibilizada do solicitante, período 01–11/11: autenticação Flow passou e PagCorp voltou a recusar Authentication/Login; não é o bloqueio administrativo da função credentials. Bloqueado pela validação/liberação da conta de integração no PagCorp ou substituição autorizada das credenciais; nenhuma permissão, credencial ou código alterado. Aviso SAP é independente e sua recuperação não foi comprovada nesta verificação.

- [ ] Open Gaming: restabelecer consulta HANA e concluir atualização de usuários sem alterar permissões. Ambos os endereços autorizados (atual e anterior) ficaram inacessíveis na porta 8001; logs da função também mostram timeout/sem rota. Consulta com sessão injetada recusada com 403 por falta de comprovação MFA; nenhuma configuração, permissão ou cadastro alterado. Bloqueado por conectividade do servidor HANA e sessão administrativa verificável pelas ferramentas.

- [ ] Solicitação 06/11 19:47 UTC: validação bloqueada. Sessão injetada restaurada no navegador em /compras voltou à tela "Verificação em duas etapas"; nenhum erro de código MFA comprovado e nenhuma proteção alterada. Consulta atual confirmou duas empresas Test ativas sem OUT00007 e quatro empresas Test inativas com regra OUT00007 ativa. Sete testes de rematch passaram; nenhum pedido criado/alterado. Aguarda sessão legitimamente MFA-validada disponível à verificação e decisão autorizada sobre empresa Test elegível; repetir MFA na interface não garante transferência às ferramentas.

- [ ] Validar pela tela um novo reembolso sintético em Test (OUT00007/7K) e conferir Daniela como aprovadora: navegador em /compras redirecionou ao MFA em 06/11/2026; empresas Test ativas (BASE 003 ANA Gaming/Providers FGR) não têm regra OUT00007, e as quatro empresas Test com regra de Daniela estão inativas (as regras estão ativas). Sete testes de rematch passaram, mas não substituem criação real. Nenhum pedido, regra ou empresa alterado; bloqueado por sessão autorizada e empresa Test ativa com regra válida.

- [x] Reembolsos: criação ignorava projeto das linhas e rematch omitia critérios de item; contexto compartilhado corrigido, segmentos mantêm tokens próprios, erros de leitura não viram lacuna. OUT00007/7K reproduzido antes e aprovado depois; 51 testes e build OK. Funções expense-mutation/expense-approval-action/expense-reassign-approver republicadas por dependência compartilhada; nenhum pedido/regras alterado. Validação pela tela com pedido sintético em Test aguarda prompt separado; ajuste cliente depende de publicação do app.

- [x] Corrigir corrida user null → usuário no Backup de anexos: carga por user.id, invalidação vinculada ao efeito de carga, testes de transição/troca com respostas antigas; 19 testes passaram, build OK, diff apresentado e publicação solicitada. RPC e permissões intactos. Validação autenticada em Live e confirmação de implantação permanecem pendentes, sem sessão aal2 disponível às ferramentas.
- [x] Corrigir inventário Backup de anexos: migration 0075 SECURITY INVOKER/RLS, uma consulta JSON por bucket sem corte de 1.000 linhas, seis consultas independentes com timeout e resultados/erros imediatos; 17 testes passaram e build OK. Gargalo comprovado no código: varredura sequencial, 3.291 pastas/4.384 arquivos no expense-attachments antes de mostrar qualquer bucket.
- [ ] Inventário Backup de anexos: validação positiva/tempo e ZIP real dependem de sessão administrativa com aal2 disponível às ferramentas; sessão --self não herdou MFA e RPC recusou com 42501 em 540 ms. Não comprovado se a sessão publicada teve erro de list/RLS vazio; publicação solicitada após testes, confirmação de implantação pendente.

- [x] Complemento Backup de anexos: SQL exato aprovado e aplicado em 0074_attachment_backup_admin_read.sql; uma política SELECT authenticated/has_role(auth.uid(), admin)/MFA para expense-attachments/nfse-xmls, lida de volta. Políticas restantes e seis buckets privados preservados; bloqueios locais removidos e fluxo uniforme para seis buckets. Testes de ZIP e contrato SQL adicionados.
- [x] Backup de anexos: página administrativa implementada com cliente autenticado/RLS existente, mapeamento compartilhado do aviso, partes locais ~200 MB, progresso, retomada e auditoria; expense-attachments/nfse-xmls bloqueados, sem novas políticas, funções ou escrita no Storage. Estado do Drive indisponível porque a tabela existente não tem política de leitura.
- [ ] Backup de anexos: testes reais nfse-pdfs/expense-attachments e permissão positiva admin com MFA bloqueados por sessão sem MFA. Rechecagem após a política: has_role retornou false e a página exibiu Acesso negado; nenhum documento real baixado. Confirmar download/ZIP/auditoria somente com sessão administrativa válida, sem contornar a proteção.

- [x] Backup Drive: export-to-gdrive publicada, catálogo de 159 tabelas/52 exclusões, cursores e staging privados, destino configurado, job 573 diário 06:30 UTC; job 69 inativo. Testes de segurança/CSV/conclusão passaram. Primeira chamada HTTP 200 com resultado error registrado (zero arquivos/bytes).
- [x] Backup Drive: conexão Douglas vinculada em 29/10 às 17:26 UTC, conta douglas.vinicius@growth.gg confirmada; export-to-gdrive usa GOOGLE_DRIVE_API_KEY da conexão vinculada e foi republicada. Job 573 executado sem exibir segredos; seis pastas, LEIA-ME, manifest e índice confirmados no Drive (3 arquivos, 33.566 bytes). Cinco testes passaram; build OK.
- [ ] Backup Drive: primeira rodada ficou running, cursor em 12/159 tabelas preparadas (50 arquivos em staging, zero arquivos de tabelas enviados); não iniciou rodada concorrente. Investigar término/limite da rodada antes de estimar prazo ou declarar sucesso da carga.
- [ ] Backup Drive: exportação real/leitura de volta e comprovar retomada/uploads; auditoria mensal .csv.gz implementada mas não exercitada em dados reais. Índice documental completo e verificação de conclusão SAP pendentes; conexão não vinculada bloqueia teste integral. Anexos pendentes pela restrição de backup Storage da plataforma; manifest não declara completo.

- [x] Lembretes — reciprocidade/fixas preservam pendências próprias e dedupe privilegia própria; férias mantidas. Nove testes passaram, função publicada, dry_run HTTP 200 nos dois canais: Leonardo 0 próprias + 1 Santiago; Santiago 1 própria + 0 em nome; Marco 2 Fernanda; Tagiane sem pendências na simulação. Agendamentos inalterados.

- [x] Histórico SAP — metadados de esboço/pedido, solicitante, identidade individual HANA e dedupe implementados; backfill concluído nas quatro empresas autorizadas. 8964 confirmado como pedido 7974/esboço 8682. 34 testes passaram. Sem número final: ANA 103, Cactus 47, Instituto 13, Open Gaming 3. Navegador autenticado/exportações aguardam prompt separado; NO-GO para confirmação visual em Live.
- [x] Lembretes diários de aprovação (e-mail + WhatsApp, dias úteis 08:00 BRT, Flow+SAP, substitutos) — ativados.

- [x] Histórico de Aprovações — audit em lotes de 200 e checkpoint por empresa, SAP/HANA limitado a 15s, finally para estado/trava, somente trava presa liberada; 19 testes passaram, função publicada e scheduler retornou HTTP 200 em 19,53s (HANA 9968 recebidos, zero alterações).

- [x] Histórico de Aprovações — filtro Minhas com identidade canônica e webhook não fatal; nove testes passaram e somente approval-history-sync foi publicada.
- [ ] Histórico de Aprovações — decisões desde 07/10 continuam zero: audit_log não contém novas decisões e dados HANA recebidos continuam até 06/10; atualização da origem SAP/HANA depende do responsável pela integração. Sync agora conclui com success e trava NULL; sessão admin das ferramentas permanece 403 MFA. Validação visual não executada (pedido do usuário exige teste de navegador em prompt separado).

- [ ] André Coura — em 28/10/2026, após Hiller informar MFA concluído no ERP Flow, a sessão fornecida às ferramentas ainda veio sem comprovação do segundo fator; consulta autenticada a has_role retornou false. Aplicação bloqueada pela sessão das ferramentas; não solicitar repetição do MFA como solução garantida. Nenhuma permissão ou regra de domínio alterada.
- [x] André Coura — esclarecido: administrador é global, não restrito à Cactus Tecnologia.
- [x] André Coura — caminho de verificação conferido: tela Verificação em duas etapas, autenticador e Confirmar; sessão das ferramentas pode omitir comprovação mesmo após MFA no app.

- [x] F01 — Cadastro aberto / domínio só no navegador
- [x] F02 — Sessão SAP amarrada à identidade
- [x] F03 — Conta de serviço SAP / sessão no navegador
- [x] F04 — Aprovação contornável por texto "PagCorp"
- [x] F05 — CNAB com dados bancários do cliente / dupla aprovação
- [x] F06 — Segredos em texto claro (cifrados; rotação pendente do usuário)
- [ ] F07 — Backup na réplica: trilha de auditoria OK + carga diária; faltam demais tabelas, contas de login e teste de restauração
- [~] F08 — HANA em HTTP / Service Layer exposto — VISTO, PENDENTE DO FORNECEDOR (SAP/Wevy: TLS no HANA, allowlist de IP/túnel no Service Layer). Parte interna opcional: restringir leitura das URLs do SAP na tabela companies.
- [~] F09 — MFA obrigatório para admin (servidor + banco exigem código), sessão admin 12h / usuário 30d nas funções, redefinição por outro admin. Faltam: os outros 3 admins cadastrarem; verificação em 2 etapas obrigatória no Google Workspace (TI).
- [x] F10 — Copiloto IA: SQL em papel restrito (sem credenciais/URLs do ERP), escrita só com clique humano no servidor, histórico validado
- [x] F11 — Auditoria com autor da sessão; empresa validada (sessão SAP/vínculo) em expense-mutation, supplier-sync; fornecedor-save com campos permitidos. Módulo em modo sombra (grupos não cobrem usuários).
- [x] F12 — Impersonação registrada no servidor (impersonation_sessions, 4h); banco recusa escritas do admin impersonando; funções só de leitura liberadas; ERP e copiloto recusam gravação (423). Falta teste real pela tela.
- [x] F13 — Logout/saída da conta apagam IndexedDB (fila offline e anexos); fila e rascunhos marcados por usuário; cache de aprovações no servidor por usuário. Falta teste real pela tela.
- [~] F14 — OCR valida token + limite de uso; imagens sem metadados, texto mascarado; só gateway sem retenção; limpeza 180d. Falta: aprovação da política (docs/politica-ia-documentos-lgpd.md).
- [~] F15 — Higiene de ambiente/inventário — VISTO. Diferença de bases explicada: novas empresas foram acopladas depois do relatório. Pontos abertos, sem mudança por ora: org Okta demo, bases de teste/nome de pessoa ativas, segredo do agendador escrito nos jobs.

- [x] CNAB standalone: fases 1–3 implementadas (lista Flow, trava, boleto, retorno, conciliação)
- [ ] CNAB standalone: relatório de fornecedores sem perfil, ensaio na empresa de teste e homologação Sicoob (até 15/10)

- [ ] Arquivo SAP produção: carga inicial em andamento (ANA, Cactus, Instituto, Open Gaming); conferir conclusão e crons diários.
- [x] Finalização S3: jobs 571/572 desativados e lidos de volta como active=false, sem apagar ou alterar código de backup; S3 não será utilizado.
- [x] Finalização agendador: aceitação de env antiga e aliases removida; 47 funções dependentes republicadas; hana-health-probe HTTP 200 com banco / 401 com env antiga; três testes passaram e build OK.
- [x] Aviso semanal de anexos pendentes de cópia manual para o Drive (attachment-backup-notice, jobs 574/575)

- [x] HANA API — troca temporária para http://187.111.23.22:8001 revertida a pedido do usuário em 12/11 17:52 UTC; ANA, Cactus, Instituto, Open Gaming e configuração hana_api novamente em 189.20.156.34:8001, conforme backup hana_api_url_backup_20261112.
- [ ] HANA API — consultas ainda falham: HanaAPI devolveu 504 "Tempo limite da consulta HANA excedido" (banco HANA atrás da API) e o login SAP Service Layer (Wevy) retornou 503 "No server is available" às 16:31 e timeout às 16:35 UTC. Depende da Wevy/equipe SAP.
