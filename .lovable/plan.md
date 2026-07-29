## Contexto

Pentest whitebox em `erp-flow.cactuscorporation.com` apontou 3 achados: 1 baixo (vazamento do histórico de compras durante o carregamento), 2 médios (CSRF/replay na troca de senha e race condition na criação de pedidos).

Ao investigar, confirmei um agravante do achado 3.2: hoje as políticas de leitura de `public.expenses`, `expense_items` e `expense_attachments` são `USING (true)` para `anon` e `authenticated`. O filtro "só vejo o que é meu" é aplicado **apenas no frontend** (`src/pages/Expenses.tsx`, linha 1236). Ou seja, não é só um "delay de renderização": qualquer portador da chave pública consegue ler todos os pedidos direto da API. A correção precisa ser server-side.

Também confirmei que `expense-mutation` (criação de pedido) **não tem rate limit nem idempotência**, e que `sap-change-password` **não exige a senha atual** (mínimo de 4 caracteres) e aceita CORS `*`.

---

## Fase 1 — Leitura de compras escopada no servidor (achado 3.2)

1. Criar edge function `expense-read` (autorizada pela sessão SAP, igual a `expense-mutation`) que resolve no servidor: identidade do usuário, grupo de permissão, alçada de centro de custo e flag "Ver todos", e retorna **apenas** as linhas permitidas, já paginadas.
2. Reaproveitar a lógica existente de `_shared/permission-groups.ts` e `user-aliases.ts` para o escopo (dono, aprovador atual, grupos privilegiados, super-admin).
3. Revogar as políticas permissivas: remover `SELECT USING (true)` de `expenses`, `expense_items` e `expense_attachments` para `anon` e `authenticated`; manter acesso por `service_role` (edge functions) e a política de admin autenticado.
4. Migrar as telas que hoje leem essas tabelas direto pelo cliente (Compras/Despesas, Aprovações, Histórico, Vendas) para a nova função, com estados de loading/empty/error e sem renderizar linha alguma antes do escopo estar resolvido.
5. Aplicar o mesmo escopo às linhas vindas do ERP/HanaAPI, para não reabrir o vazamento por outra origem.

## Fase 2 — Troca de senha: CSRF/replay (achado 3.3)

1. Exigir a **senha atual** em `sap-change-password`: validar com um login real no SAP antes do PATCH; sem isso, 401.
2. Política de senha forte: mínimo 12 caracteres, bloqueio de senhas triviais e checagem de vazamento (HIBP habilitado no Auth), substituindo o mínimo atual de 4.
3. CORS restrito por allowlist de origens (domínio de produção + preview), removendo `Access-Control-Allow-Origin: *` nas funções sensíveis — isso já quebra o cenário do HTML malicioso.
4. Exigir um token anti-CSRF de uso único, emitido pela sessão e ligado ao usuário, obrigatório na troca de senha (defesa em profundidade, conforme a recomendação do relatório).
5. Manter/reforçar o rate limit existente (ex.: 5 tentativas por usuário/IP a cada 15 min) e registrar cada troca (sucesso e falha) na auditoria.
6. Invalidar as sessões SAP/ERP ativas do usuário após a troca.

## Fase 3 — Race condition na criação de pedidos (achado 3.4)

1. Idempotência: o cliente envia um `Idempotency-Key`; a função grava a chave e devolve o mesmo resultado para repetições, em vez de criar N pedidos.
2. Trava por usuário/empresa durante a criação (lock advisory no Postgres, no padrão já usado em `_shared/watcher-lock.ts`), serializando requisições paralelas do mesmo usuário.
3. Deduplicação por assinatura de negócio: mesmo fornecedor + valor + data + itens dentro de uma janela curta é rejeitado como duplicata, com mensagem clara.
4. Rate limit em `expense-mutation` (`enforceRateLimit`), separado por ação (create mais restrito).
5. No frontend, desabilitar o botão de envio durante o request (não é a correção, é só higiene de UX).

## Fase 4 — Endurecimento geral e validação

1. Cabeçalhos de segurança na aplicação publicada: CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors`, `Referrer-Policy`.
2. Varredura das demais edge functions para aplicar o mesmo padrão de CORS por allowlist e rate limit nas rotas sensíveis.
3. Revisão de RLS das demais tabelas com `USING (true)` de leitura, mesmo escopo de raciocínio da Fase 1.
4. Rodar o linter/scanner de segurança e atualizar a memória de segurança do projeto.
5. Reteste dos 3 cenários do relatório: leitura da lista com usuário restrito (via API, não só na tela), replay do HTML de troca de senha e envio paralelo em grupo no Burp.

## Detalhes técnicos

- Arquivos principais: `supabase/functions/expense-mutation/index.ts`, `supabase/functions/sap-change-password/index.ts`, `supabase/functions/_shared/{auth,rate-limit,permission-groups,user-aliases}.ts`, `src/pages/Expenses.tsx`, `src/pages/Approvals.tsx`, nova função `expense-read`, nova migração de RLS.
- A Fase 1 é a de maior risco de regressão, pois muda a origem dos dados de várias telas; será feita mantendo o contrato de dados atual para minimizar impacto.
- Nenhuma credencial nova é necessária.

## Ordem sugerida

Fase 1 → Fase 3 → Fase 2 → Fase 4. As fases 1 e 3 fecham o risco de exposição de dados e de indisponibilidade; a 2 depende de decidir a política de senha com o time.
