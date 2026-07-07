# Plano de Melhoria — ERP (priorização por criticidade)

> Estruturado como épicos → tarefas → critérios de aceite (DoD).
> Fases: **F1 imediata**, **F2 curto prazo**, **F3 médio prazo**.
> Criticidade: 🔴 Alta · 🟠 Média-Alta · 🟡 Média.

---

## FASE 1 — Imediata

### Épico 1 · Controle de acesso e autorização 🔴
**Objetivo:** garantir menor privilégio, padronizar validação em toda rota/ação e impedir bypass client-side.

**Tarefas**
1. **Auditar `user_roles` + `has_role`**
   - Mapear todos os papéis existentes (`admin`, `approver`, `user`, etc.) e onde são consultados.
   - Confirmar que nenhum papel é persistido em `profiles` ou `localStorage`.
2. **Matriz de permissões centralizada**
   - Criar `src/lib/permissions.ts` com enum `Permission` e mapa `role → Permission[]`.
   - Hook `usePermission(perm)` como única fonte de verdade no client.
3. **Guardas de rota**
   - `<RequireAuth>` + `<RequirePermission perm=...>` aplicados em `src/App.tsx` a TODAS as rotas administrativas / backoffice.
4. **Reforço server-side**
   - Toda RLS que hoje usa somente `auth.uid()` revisada para exigir também papel quando a ação for sensível (aprovação, exclusão, override).
   - Edge Functions sensíveis validam `has_role` no início e retornam 403 explícito.
5. **Ocultação vs. bloqueio**
   - Componentes escondidos por role também devem falhar no backend se chamados diretamente (RLS/policy/Edge).
6. **Revisão de acessos administrativos**
   - Listar usuários com `admin` hoje, validar com dono do produto, remover excedentes.

**Critérios de aceite**
- [ ] Documento `docs/permissions-matrix.md` gerado (papel × módulo × ação × onde é validado).
- [ ] Nenhuma tela sensível acessível via URL direta sem passar por guarda.
- [ ] Teste manual: usuário `user` não consegue nem via UI nem via chamada direta ao PostgREST executar ações restritas.
- [ ] `security--run_security_scan` sem findings de RLS aberta / policy `USING (true)`.

---

### Épico 2 · Auditoria completa e rastreável 🔴
**Objetivo:** trilha única, filtrável, cobrindo login, dados, aprovações, integrações e permissões.

**Tarefas**
1. **Modelo unificado**
   - Tabela `audit_events` (`id`, `occurred_at`, `actor_user_id`, `actor_email`, `company_db`, `module`, `entity_type`, `entity_id`, `action`, `status`, `before jsonb`, `after jsonb`, `context jsonb`, `ip`, `user_agent`).
   - RLS: `SELECT` só para admin/auditor; `INSERT` via Edge Function `log-audit-event` (service_role).
2. **Consolidação**
   - Mapear tabelas de log já existentes (`audit_logs`, `integration_logs`, `notifications`, etc.) e migrar/espelhar para o modelo unificado, sem quebrar telas atuais.
3. **Eventos obrigatórios**
   - Auth: login OK/falha, logout, troca de senha.
   - Dados: create/update/delete em documentos, despesas, fornecedores, empresas.
   - Aprovação: submit, aprovar, rejeitar, reatribuir, cancelar.
   - Integrações: request, response, erro, retry (SAP, PagCorp).
   - Permissões: mudança em `user_roles`, `user_module_permissions`.
4. **Tela de auditoria**
   - `src/pages/AuditLog.tsx` com filtros: período, usuário, empresa, módulo, entidade, ação, status.
   - Export CSV respeitando as mesmas colunas de auditoria já usadas no CreateExpenseModal.
5. **Falhas também são registradas**
   - Interceptor no client (`supabase.functions.invoke` wrapper) e nas Edge Functions garante que exceções entrem em `audit_events` com `status='error'`.

**Critérios de aceite**
- [ ] Um evento por ação crítica — verificável percorrendo um fluxo real (criar despesa → aprovar → integrar).
- [ ] Página `/auditoria` acessível apenas por admin/auditor, com filtros funcionando.
- [ ] Nenhum log contém segredos, tokens ou payloads sensíveis (PII truncada/mascarada).

---

### Épico 3 · Integridade e consistência dos dados 🔴
**Objetivo:** eliminar estados inconsistentes entre plataforma, cache local e SAP.

**Tarefas**
1. **Constraints e validações no banco**
   - Revisar `NOT NULL`, `CHECK`, `UNIQUE` em tabelas críticas (documentos, despesas, aprovações, links PagCorp/SAP).
   - Enums em Postgres em vez de string livre onde couber.
2. **Idempotência**
   - Chaves naturais (`company_db + doc_num + doc_type`, `pagcorp_link + card_code` etc.) protegidas por `UNIQUE`.
   - Edge Functions de importação/integração usam `upsert` com `onConflict` explícito.
3. **Regras de negócio no server**
   - Migrar validações que hoje só existem no front (limites de valor, transições de status, campos obrigatórios por tipo) para triggers/Edge Functions.
4. **Reconciliação SAP × local**
   - Job (Edge scheduled) que compara `sap_cache` × dados operacionais e emite relatório de divergência.
   - Tela admin para revisar e corrigir divergências.
5. **Transições de status seguras**
   - Trigger que bloqueia transições inválidas (ex.: `rejected → paid`).

**Critérios de aceite**
- [ ] Impossível inserir documento duplicado por (company + doc_num + tipo).
- [ ] Impossível pular status de aprovação por chamada direta ao PostgREST.
- [ ] Relatório de divergência disponível e vazio (ou justificado) em produção.

---

### Épico 4 · Segurança nas integrações externas 🔴
**Objetivo:** integrações observáveis, com segredos protegidos e falhas visíveis.

**Tarefas**
1. **Inventário de integrações**
   - SAP B1 Service Layer, PagCorp, e-mail, quaisquer outras — listar em `docs/integrations.md` com endpoint, auth, dono do segredo.
2. **Segredos**
   - Confirmar que nenhuma chave sensível está no bundle (`rg -n "sk-|sk_live|service_role" src/`).
   - Todos os segredos em Edge Functions via `Deno.env.get`.
3. **Wrapper padrão de chamada externa**
   - `supabase/functions/_shared/http.ts` com timeout, retry exponencial (para 5xx/timeout), log estruturado, sanitização de headers.
4. **Registro de request/response**
   - Salvar em `integration_logs` (ou `audit_events` com `module='integration'`) status, latência, hash do payload; nunca body cru com PII/segredos.
5. **Alertas e fallback**
   - Falhas consecutivas > N em janela X disparam notificação para admin (tabela `notifications` respeitando a regra de empresas TST).
6. **CORS restrito**
   - Nenhuma Edge Function com `Access-Control-Allow-Origin: *` + credenciais; allowlist por ambiente.

**Critérios de aceite**
- [ ] `docs/integrations.md` publicado.
- [ ] Nenhum segredo detectável no bundle produzido pelo build.
- [ ] Falha simulada de SAP produz log estruturado + alerta + retry conforme política.

---

## FASE 2 — Curto prazo

### Épico 5 · Validação de entrada e regras de negócio 🟠
**Tarefas**
1. Padronizar validação com **Zod** — schema por formulário e mesmo schema reutilizado na Edge Function.
2. Sanitização de saída (evitar `dangerouslySetInnerHTML`; se necessário, DOMPurify).
3. Mensagens de erro consistentes (util `formatApiError`).
4. Rate limiting em endpoints sensíveis (login helper, reset, chamadas de IA caras) — via Edge Function + tabela `rate_limit_hits`.

**Critérios de aceite**
- [ ] Todo formulário crítico usa schema Zod compartilhado.
- [ ] Chamada direta ao endpoint com payload inválido retorna 400 estruturado.
- [ ] Login/reset: > N tentativas em X min bloqueia.

---

### Épico 6 · UX sem comprometer segurança 🟡
**Tarefas**
1. Revisar fluxos de aprovação, cadastro e revisão — reduzir cliques, mostrar progresso.
2. Estados vazios, loading e erro padronizados (`<EmptyState>`, `<ErrorState>`).
3. Reorganizar navegação por papel: menu já filtrado pela matriz do Épico 1.
4. Feedback visível (toast + inline) em ações destrutivas com confirmação.

**Critérios de aceite**
- [ ] Redução mensurável de cliques nos 3 fluxos mais usados.
- [ ] Nenhum estado sem feedback (loading/erro/vazio).

---

### Épico 7 · Logs mais ricos e consultáveis 🟠
**Tarefas**
1. Padronizar logger no client (`src/lib/logger.ts`) e nas Edge Functions (`_shared/logger.ts`) com níveis e correlação (`request_id`).
2. Propagar `request_id` do client → Edge → SAP.
3. Tela de auditoria (Épico 2) ganha filtro por `request_id`.

**Critérios de aceite**
- [ ] Dado um `request_id` é possível reconstruir toda a cadeia de uma ação.

---

## FASE 3 — Médio prazo

### Épico 8 · Resiliência operacional 🟡
**Tarefas**
1. Error boundaries por módulo.
2. Padrão de retry/compensação em jobs assíncronos.
3. Ferramenta admin para reprocessar item da fila com contexto preservado.
4. Health checks das integrações + página `/status` interna.

**Critérios de aceite**
- [ ] Falha em uma integração não derruba o módulo inteiro.
- [ ] Item da fila pode ser reprocessado sem duplicar efeitos.

---

### Épico 9 · Arquitetura para evolução 🟡
**Tarefas**
1. Organização por domínio: `src/modules/<dominio>/` (expenses, suppliers, approvals, integrations, admin).
2. Abstrações reutilizáveis: `useSapEntity`, `useIntegrationCall`, `useAuditedMutation`.
3. Padronizar hooks/serviços e remover duplicações identificadas.
4. Documentação técnica em `docs/` (decisões, fluxos, regras).

**Critérios de aceite**
- [ ] Novo módulo pode ser criado seguindo template documentado.
- [ ] Duplicações-chave (fetch SAP, permissão, audit) centralizadas.

---

### Épico 10 · Governança e conformidade 🟡
**Tarefas**
1. Política escrita de acesso, alteração e aprovação (`docs/governance.md`).
2. Checklist de segurança/auditoria por nova feature (`docs/feature-checklist.md`).
3. Processo de revisão de papéis (trimestral).
4. Definir o que é auditável por obrigação regulatória vs. interno.

**Critérios de aceite**
- [ ] Toda nova feature abre com checklist preenchido.
- [ ] Revisão de papéis registrada em `audit_events`.

---

## Resumo executivo

| Prioridade | Épicos |
|---|---|
| 🔴 Alta (F1) | 1 Acesso · 2 Auditoria · 3 Integridade · 4 Integrações |
| 🟠 Média-alta (F2) | 5 Validação · 7 Logs |
| 🟡 Média (F2/F3) | 6 UX · 8 Resiliência · 9 Arquitetura · 10 Governança |

**Recomendação de execução:** atacar F1 em paralelo por épico, com Épico 1 e 2 como base porque destravam critérios de aceite dos demais (autorização e auditoria são pré-requisito para validar 3 e 4).
