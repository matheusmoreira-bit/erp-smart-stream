# ERP Flow — Relatório de Segurança V4.0

| Campo | Valor |
| --- | --- |
| Versão | 4.0 (substitui a avaliação de 24/09/2026) |
| Data-base | 28/09/2026 |
| Método | Reteste dos 15 achados (F01–F15): chamadas à API sem/ com login, leitura do banco de produção e revisão de código |
| Classificação | Confidencial — Uso Interno |

## Sumário executivo

| Situação | Qtde | Achados |
| --- | --- | --- |
| Fechado | 10 | F01, F02, F03, F04, F05, F06, F07, F09, F10, F12, F13* |
| Parcial / depende de outro time | 4 | F08 (fornecedor), F11 (checagem de módulo em modo registro), F14 (política LGPD), F15 (inventário) |

\* Contagem conforme reteste por item; ver observação em F09.

Testes gerais aprovados em 28/09/2026:
- **208 de 208** tabelas do schema público com RLS ativo (`pg_tables.rowsecurity`).
- Leitura das credenciais de fora do sistema (chave pública, sem login): **recusada**.
- 7 funções testadas sem login válido: **todas recusaram (401/403)**.

## Críticos

### F01 — Cadastro aberto — FECHADO
- **Correção:** cadastro público desativado; domínio corporativo validado no servidor.
- **Evidência:** tentativa de cadastro com e-mail externo recusada com "cadastro desativado" (signup disabled). Revisão das 135 contas: nenhuma com domínio fora da lista permitida (`anagaming.com.br`, `cactusgaming.net`, `growth.gg`, `opengaming.com.br`, `lotusblanca.net`, `cactuscorporation.com`).

### F02 — Sessão SAP sem ligação com quem está logado — FECHADO
- **Correção:** token HMAC obrigatório e conferência do dono da sessão em `_shared/auth.ts`; `manager` sem privilégio implícito.
- **Evidência:** chamada externa ao proxy do ERP (`sap-b1-proxy`) sem login válido → **401**.

### F03 — Conta de serviço do ERP liberada para todos — FECHADO
- **Correção:** ApiUser restrito a leitura no servidor; sessão do ERP não é entregue ao navegador para escrita.
- **Evidência:** escrita via conta de serviço recusada. Efeito colateral observado em 28/09 (criação de usuário pela tela exigindo login pessoal) — corrigido na tela, sem reabrir o achado.

### F04 — Aprovação pulada pelo texto "PagCorp" — FECHADO
- **Correção:** marcação de cartão só por `origin = "pagcorp"`, gravada pela tela/integração PagCorp; texto na observação não altera o fluxo.
- **Evidência:** despesa com "PagCorp" na observação segue a matriz de alçadas normal.

### F05 — CNAB com dados do navegador — FECHADO
- **Correção:** dados bancários lidos do cadastro aprovado no servidor; lote exige aprovação de uma segunda pessoa.
- **Evidência:** geração do lote ignora dados bancários enviados pelo cliente; lote sem segundo aprovador não é liberado.

### F06 — Senhas e chaves em texto claro — FECHADO (cifra)
- **Correção:** credenciais cifradas (`enc:v1:`, AES-GCM) com chave apenas no servidor.
- **Evidência:** conferência em 28/09: todas as credenciais armazenadas estão cifradas. Rotação na origem segue como boa prática recomendada.

## Altos

### F07 — Backup — FECHADO
- **Correção:** backup incremental diário para réplica em conta externa (Supabase fora da Lovable), incluindo arquivos (`replica-storage-sync`, 03:45 Brasília). Réplica sem rotinas nem funções ativas.
- **Evidência:** `infra_backup_log` com 109 execuções nos últimos 7 dias; última em 28/09/2026 06:15 UTC. Procedimento: `docs/runbook-backup-restore.md`.

### F08 — HANA e ERP abertos na internet — VISTO, DEPENDE DO FORNECEDOR
- **Dono:** SAP / Wevy — TLS no HANA e allowlist de IP ou túnel no Service Layer.
- **Evidência:** ação registrada e encaminhada; sem mudança possível no app.

### F09 — Sem MFA — FECHADO (admins)
- **Correção:** MFA (TOTP, `aal2`) obrigatório para administradores no banco (`has_role`) e nas funções (`requireUser`); tela `AdminMfaGate`; redefinição só por outro admin, com auditoria (`mfa_factor_reset`).
- **Evidência:** admin sem segundo fator recebe 403 nas funções administrativas. 4 contas com papel admin (3 pessoas).
- **Observação:** o resumo recebido indica F09 como "não tratado", mas o reteste por item o classifica como fechado para admins. Pendências: confirmar cadastro do fator por todos os admins e exigir 2 etapas no Google Workspace (TI).

### F10 — Copiloto de IA — FECHADO
- **Correção:** SQL em papel restrito `copilot_reader`, sem acesso a credenciais/URLs do ERP; escrita só com clique em "Confirmar" validado no servidor.
- **Evidência:** acesso sem login recusado (testado).

### F11 — Auditoria e isolamento entre empresas — FECHADO (autoria e empresa) / PARCIAL (módulo)
- **Correção:** autor gravado a partir da sessão (`insert_audit_log` ignora autor informado); empresa validada em `expense-mutation` e `supplier-sync`.
- **Evidência:** tentativa de autoria forjada gravada com o autor real. Checagem de módulo em modo sombra (registra, não bloqueia).

## Médios

### F12 — Atuar como outra pessoa — FECHADO
- **Correção:** impersonação registrada no servidor (4h); banco recusa escritas do admin impersonando; ERP e copiloto respondem 423.
- **Evidência:** 621 travas de somente leitura ativas no banco.

### F13 — Dados locais após sair — FECHADO
- **Correção:** logout apaga IndexedDB, filas offline, rascunhos e anexos locais.
- **Evidência:** após sair, armazenamento local vazio.

### F14 — IA com documentos — FECHADO NO TÉCNICO
- **Correção:** OCR valida token e limite de uso; imagens sem metadados; texto mascarado; retenção 180 dias.
- **Evidência:** token de captura pelo celular inventado → recusado (testado).
- **Pendente:** aprovação de `docs/politica-ia-documentos-lgpd.md` (Jurídico/DPO/Controladoria).

### F15 — Ambiente e inventário — VISTO
- **Evidência:** divergência de bases explicada pela inclusão de novas empresas (Omie) em 23/09/2026.
- **Pontos abertos sem ação por ora:** org Okta demo, bases de teste ativas, segredo do agendador nos jobs.

## Histórico de versões
| Versão | Data | Mudança |
| --- | --- | --- |
| 3.0 | 24/09/2026 | Avaliação inicial: 15 achados (6 críticos, 5 altos, 4 médios) |
| 4.0 | 28/09/2026 | Reteste com evidências por achado |
