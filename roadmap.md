# Roadmap — Melhorias de segurança (pentest)

- [x] Backup Drive: export-to-gdrive publicada, catálogo de 159 tabelas/52 exclusões, cursores e staging privados, destino configurado, job 573 diário 06:30 UTC; job 69 inativo. Testes de segurança/CSV/conclusão passaram. Primeira chamada HTTP 200 com resultado error registrado (zero arquivos/bytes).
- [ ] Backup Drive: em 29/10 às 17:20 UTC, ambas as conexões Douglas continuam não vinculadas e não vinculáveis (proprietário do projeto sem acesso), apesar da confirmação do usuário. Nova conexão confirmou douglas.vinicius@growth.gg; rodada idêntica ao job 573 retornou HTTP 200/status error e persistiu zero tabelas/arquivos/bytes. ERP-Flow-Backup segue vazia, sem LEIA-ME/manifest. Proprietário da conexão precisa conceder Can use ao proprietário do projeto; não copiar chave de chamada avulsa nem usar conexão alheia. Prazo indeterminado até vinculação válida.
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
