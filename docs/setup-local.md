# Guia de Setup Local — ERP Flow

Passo a passo para rodar o projeto na sua máquina, entender as variáveis de ambiente, comandos de desenvolvimento e validar que tudo está funcionando.

---

## 1. Pré-requisitos

| Ferramenta | Versão mínima | Observação |
|---|---|---|
| **Node.js** | 20.x LTS | Necessário mesmo usando Bun (algumas ferramentas compilam via Node). |
| **Bun** | 1.1+ | Gerenciador de pacotes e runner padrão do projeto (`bun.lock` versionado). |
| **Git** | 2.40+ | Clone e histórico. |
| **Docker Desktop** *(opcional)* | 24+ | Só necessário se for rodar `supabase start` local. Não é obrigatório — o projeto usa **Lovable Cloud** por padrão. |
| **Editor** | VS Code recomendado | Extensões sugeridas: ESLint, Tailwind CSS IntelliSense, Deno (para Edge Functions). |

Verifique:

```bash
node -v      # v20.x
bun -v       # 1.1+
git --version
```

---

## 2. Clonar e instalar dependências

```bash
git clone <URL_DO_REPOSITORIO> erp-flow
cd erp-flow
bun install
```

`bun install` lê `bun.lock` (lockfile em texto) e resolve tudo. Não use `npm install` nem `yarn` — a lockfile é do Bun e vai divergir.

---

## 3. Variáveis de ambiente

Existem **dois planos** de segredos: build/runtime do front (`.env` na raiz) e segredos das Edge Functions (armazenados no Lovable Cloud, nunca em arquivo).

### 3.1 Front-end (`.env` na raiz)

O arquivo `.env` já vem preenchido pela conexão Lovable Cloud. Ele contém **apenas chaves públicas** (a anon key é feita para o browser; RLS é quem protege os dados):

```bash
VITE_SUPABASE_PROJECT_ID="ryxlofwbyhkqcvzavbwn"
VITE_SUPABASE_URL="https://ryxlofwbyhkqcvzavbwn.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key>"
```

Regras:

- **Não** apague nem mude esses valores. Se sumirem, o app publicado quebra (o client em `src/integrations/supabase/client.ts` inicializa com `undefined`).
- Se estiver rodando contra Lovable Cloud gerenciado, use o `.env` que já vem do projeto. Se o `.env` estiver ausente, reconecte o Lovable Cloud em vez de editar à mão.
- Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` no `.env` do front — ela é exclusiva das Edge Functions.

### 3.2 Edge Functions / Backend (segredos gerenciados)

Segredos como `LOVABLE_API_KEY`, `PAGCORP_CLIENT_SECRET`, `SMTP_*`, `WHATSAPP_*`, `GDRIVE_SERVICE_ACCOUNT` etc. **não vivem em arquivo** — ficam no cofre do Lovable Cloud e são injetados como `Deno.env.get("NOME")` dentro de `supabase/functions/*/index.ts`.

Para inspecionar/adicionar segredos, use os canais oficiais:

- No Lovable: barra lateral **Backend → Secrets** (ou peça ao agente).
- CLI (opcional): `supabase secrets list --project-ref <ref>`.

Segredos comuns esperados pelo projeto (referência rápida — a lista canônica está em `docs/api-edge-functions.md`):

| Segredo | Onde é usado |
|---|---|
| `LOVABLE_API_KEY` | Todas as functions que chamam Lovable AI Gateway (`ai-assistant`, `report-ai-chat`, `supplier-ai-extract`, `audit-console-analyze-doc`, `process-expense-doc`). |
| `PAGCORP_CLIENT_ID` / `PAGCORP_CLIENT_SECRET` / `PAGCORP_AES_KEY` | `pagcorp-*` |
| `OMIE_APP_KEY` / `OMIE_APP_SECRET` (por empresa em `system_credentials`) | `omie-proxy` |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | `send-smtp-email`, `process-email-queue` |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` | `whatsapp-*` |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | `backup-to-gdrive` |
| `JUMPCLOUD_API_KEY` | `jumpcloud-proxy`, `idp-mapping` |
| `MASTERTAX_*` | `mastertax-pull`, `mastertax-test` |

> Rodando localmente contra Lovable Cloud gerenciado, você **não precisa** configurar esses segredos na sua máquina — as functions rodam remotamente. O que sua máquina faz é apenas servir o SPA em `localhost:8080` e chamar as functions já deployadas.

---

## 4. Comandos de desenvolvimento

Todos os scripts abaixo estão em `package.json`.

| Comando | O que faz |
|---|---|
| `bun run dev` | Sobe o Vite em `http://localhost:8080` com HMR. Modo padrão de desenvolvimento. |
| `bun run build` | Build de produção em `dist/`. |
| `bun run build:dev` | Build com modo `development` (source maps, sem minify agressivo). |
| `bun run preview` | Serve o `dist/` para conferir o bundle final localmente. |
| `bun run lint` | Roda ESLint em todo o projeto. |
| `bun run test` | Roda a suíte Vitest uma vez (unit tests em `src/**/*.test.ts`). |
| `bun run test:watch` | Vitest em modo watch. |

### 4.1 Rodar Edge Functions localmente (opcional)

Só necessário para depurar uma function específica sem redeploy. Requer Docker + Supabase CLI.

```bash
# uma única vez
bun add -g supabase
supabase login
supabase link --project-ref ryxlofwbyhkqcvzavbwn

# servir uma function
supabase functions serve <nome> --env-file supabase/.env.local --no-verify-jwt
```

`supabase/.env.local` fica **fora do git** (`.gitignore`) e contém apenas os segredos que a function precisa para o teste local.

---

## 5. Validação — checklist pós-instalação

Execute na ordem. Se qualquer passo falhar, veja a seção **6. Troubleshooting**.

### 5.1 Lint + testes

```bash
bun run lint
bun run test
```

Esperado: `0 errors` no lint e todos os testes verdes (há suítes em `src/hooks/useApprovalRules.test.ts`, `src/lib/approvalSegments.test.ts`, `src/lib/expense-dedupe.test.ts`, `src/lib/report-pdf.test.ts`, etc.).

### 5.2 Build de produção

```bash
bun run build
```

Esperado: termina sem erro, gera `dist/index.html` + assets. Se ele reclamar de `VITE_SUPABASE_URL undefined`, o `.env` está ausente ou vazio (ver 3.1).

### 5.3 Servidor de desenvolvimento

```bash
bun run dev
```

Abra `http://localhost:8080`. Você deve ver a tela de login (`AdminLogin`). Faça login com um usuário do Lovable Cloud.

Checklist visual:

- [ ] Login funciona (redireciona para `/` sem erro no console).
- [ ] `Network` do DevTools mostra chamadas a `https://ryxlofwbyhkqcvzavbwn.supabase.co/rest/v1/…` com status **200** e header `apikey` presente.
- [ ] Nenhuma requisição vai para `undefined/…` (indica `.env` quebrado).
- [ ] `Console` sem erros vermelhos de RLS (`permission denied`, `PGRST…`).
- [ ] O `SapContext` popula (após login SAP no formulário do topo, aparecem empresas em `companies`).

### 5.4 Sanidade das Edge Functions

Com o dev server rodando e logado, no DevTools → Console:

```js
const { data, error } = await window.__supabase.functions.invoke("cnpj-lookup", {
  body: { cnpj: "00000000000191" }
});
console.log(data, error);
```

> `window.__supabase` só existe se estiver exposto para debug; alternativa: chame pela UI abrindo a tela **Fornecedores → Novo → buscar CNPJ**. Um retorno com `razao_social` preenchido confirma que o front está conseguindo invocar Edge Functions autenticadas.

### 5.5 Fluxo funcional mínimo

1. Logar em `/`.
2. Ir em **Aprovações** — a lista deve carregar (mesmo que vazia).
3. Ir em **Despesas** — botão "Nova despesa" abre o modal.
4. Ir em **Integrações → Monitor** — o card de saúde deve mostrar timestamps recentes.

Se os quatro passos passam sem erro no console, o setup está saudável.

---

## 6. Troubleshooting

| Sintoma | Causa provável | Correção |
|---|---|---|
| Tela branca após `bun run build && bun run preview` | `.env` ausente ou `VITE_SUPABASE_*` vazias no momento do build. | Restaure o `.env` (não hardcode) e refaça o build. |
| `bun install` falha em `@lovable.dev/cloud-auth-js` | Registry privado sem token de build. | Verifique **Workspace Settings → Build Secrets** (`NPM_TOKEN`). |
| 401 em todas as chamadas `/rest/v1/…` | Anon key desatualizada. | Reconecte Lovable Cloud; o `.env` será reescrito. |
| Console mostra `permission denied for table X` | Usuário sem role `admin` mas tentando abrir tela restrita. | Peça a um admin para adicionar linha em `user_roles` com `role='admin'`. |
| Edge Function retorna 500 com `LOVABLE_API_KEY missing` | Segredo não configurado no backend. | Peça ao agente (ou admin do projeto) para criar via `add_secret`/`ai_gateway--create`. |
| `bun run test` falha em `report-pdf.test.ts` com erro de fonte | Cache do vitest. | `rm -rf node_modules/.vite node_modules/.vitest && bun install`. |
| HMR não atualiza | Porta 8080 ocupada. | `lsof -i :8080` e mate o processo; ou rode `PORT=5173 bun run dev`. |
| `supabase functions serve` erra `Docker not running` | Docker Desktop parado. | Ligue o Docker. Etapa é opcional — pule se não for depurar function local. |

---

## 7. Convenções importantes

- **Nunca edite** `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts` nem `supabase/config.toml` (configurações de projeto). São auto-gerados.
- Segredos vão em `add_secret` — **nunca** hardcoded, nunca em `.env` versionado.
- Migrations SQL: criar via ferramenta de migration (não editar arquivos existentes). Toda tabela em `public` exige `GRANT` + RLS + policies (ver `docs/handover-tecnico.md § Banco de Dados`).
- Antes de commitar: `bun run lint && bun run test && bun run build` verdes.

---

## 8. Referências rápidas

- Arquitetura geral: `docs/diagramas/01-arquitetura.png`
- Handover técnico completo: `docs/handover-tecnico.md`
- Referência de Edge Functions: `docs/api-edge-functions.md`
- Relatório executivo: `docs/relatorio-executivo.md`
- Relatório técnico + segurança: `docs/relatorio-tecnico.md`
