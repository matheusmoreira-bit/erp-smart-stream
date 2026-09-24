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
