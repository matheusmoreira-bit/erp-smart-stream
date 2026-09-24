# Roadmap — Melhorias de segurança (pentest)

- [x] F01 — Cadastro aberto / domínio só no navegador
- [x] F02 — Sessão SAP amarrada à identidade
- [x] F03 — Conta de serviço SAP / sessão no navegador
- [x] F04 — Aprovação contornável por texto "PagCorp"
- [x] F05 — CNAB com dados bancários do cliente / dupla aprovação
- [x] F06 — Segredos em texto claro (cifrados; rotação pendente do usuário)
- [ ] F07 — Backup na réplica: trilha de auditoria OK + carga diária; faltam demais tabelas, contas de login e teste de restauração
- [~] F08 — HANA em HTTP / Service Layer exposto — VISTO, PENDENTE DO FORNECEDOR (SAP/Wevy: TLS no HANA, allowlist de IP/túnel no Service Layer). Parte interna opcional: restringir leitura das URLs do SAP na tabela companies.
- [ ] F09
- [x] F10 — Copiloto IA: SQL em papel restrito (sem credenciais/URLs do ERP), escrita só com clique humano no servidor, histórico validado
- [x] F11 — Auditoria com autor da sessão; empresa validada (sessão SAP/vínculo) em expense-mutation, supplier-sync; fornecedor-save com campos permitidos. Módulo em modo sombra (grupos não cobrem usuários).
- [x] F12 — Impersonação registrada no servidor (impersonation_sessions, 4h); banco recusa escritas do admin impersonando; funções só de leitura liberadas; ERP e copiloto recusam gravação (423). Falta teste real pela tela.
- [x] F13 — Logout/saída da conta apagam IndexedDB (fila offline e anexos); fila e rascunhos marcados por usuário; cache de aprovações no servidor por usuário. Falta teste real pela tela.
- [~] F14 — OCR valida token + limite de uso; imagens sem metadados, texto mascarado; só gateway sem retenção; limpeza 180d. Falta: aprovação da política (docs/politica-ia-documentos-lgpd.md).
- [~] F15 — Higiene de ambiente/inventário — VISTO. Diferença de bases explicada: novas empresas foram acopladas depois do relatório. Pontos abertos, sem mudança por ora: org Okta demo, bases de teste/nome de pessoa ativas, segredo do agendador escrito nos jobs.
