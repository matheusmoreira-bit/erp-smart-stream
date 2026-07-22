
## Contexto

Hoje o Cloudflare Access protege o domínio do ERP Flow como primeira barreira. A migração para Okta acontecerá em duas camadas complementares:

1. **Edge (borda)** — substitui o CF Access. Toda requisição HTTP ao domínio precisa de sessão Okta válida antes de chegar ao app.
2. **App (dentro do ERP Flow)** — após passar pela borda, o usuário ainda faz login no app via Okta (SSO), em vez de senha SAP/OMIE local.

Login SAP/OMIE atual (email/senha, Google) deixa de existir para usuários normais. Apenas super-admins mantêm um fallback local de emergência.

---

## Camada 1 — Edge (substituir Cloudflare Access por Okta)

Essa camada **não é código do app** — é infraestrutura. O Lovable não hospeda esse proxy. Precisa ser feito por quem gerencia DNS/edge hoje. Duas opções padrão:

- **Okta Access Gateway (OAG)** — appliance da Okta que faz o mesmo papel do CF Access.
- **Cloudflare Zero Trust + Okta como IdP OIDC** — mantém o CF na frente, mas troca o IdP interno dele para Okta OIDC. Menor esforço se já usam Cloudflare.

Recomendação: **manter Cloudflare Zero Trust e apenas trocar o IdP de "CF Access built-in" para "Okta OIDC"**. Zero mudança de DNS, zero mudança no app, políticas atuais continuam valendo.

Para essa configuração no Cloudflare Zero Trust → Settings → Authentication → Add OIDC → Okta, o **redirect/callback URI a informar no Okta** é:

```
https://<seu-team>.cloudflareaccess.com/cdn-cgi/access/callback
```

(troque `<seu-team>` pelo team name atual do CF Zero Trust).

Se optarem por OAG puro, o callback é definido pelo próprio OAG na instalação — nesse caso me avisem para eu documentar depois.

---

## Camada 2 — App (login do ERP Flow via Okta)

Okta suporta **SAML nativamente** no Supabase Auth (usado pelo Lovable Cloud). É o caminho suportado e sem edge function custom. OIDC "puro" no Supabase não é gerenciado — exigiria uma edge function trocando `code` por sessão, mais frágil.

**Proposta: usar Okta via SAML SSO** (funcionalmente equivalente para o usuário final — botão "Entrar com Okta" → redirect Okta → volta logado).

### Passos

1. **Ativar SAML SSO no Lovable Cloud** via ferramenta `configure_saml_sso`. Ela abre um formulário que já mostra o **ACS URL** e **Entity ID** deste projeto (esses são os valores a colar no Okta ao criar o SAML app).
2. **Criar SAML app na Okta** com os valores acima e informar domínios de email (`@anagaming.com.br`, `@cactuscorporation.com`, etc.) para roteamento SSO.
3. **Colar o metadata URL da Okta** de volta no formulário do Lovable — encerra a configuração server-side.
4. **Refactor de `SapLoginForm.tsx` e `AdminLogin.tsx`**: remover formulário email/senha para usuários normais; substituir por botão único "Entrar com Okta" que dispara `supabase.auth.signInWithSSO({ domain })`. Manter caixa colapsável "Login de emergência (super-admin)" com o fluxo atual.
5. **`SapContext`**: após sessão Okta hidratada, continuar chamando `sapLogin`/OMIE login com o email do usuário Okta + senha de serviço mapeada (ou sem senha, se migrarmos SAP para JWT via edge function no futuro — fora deste escopo).
6. **Fluxo pós-login preservando destino**: guardar `next` em `sessionStorage` antes do redirect Okta, aplicar após `onAuthStateChange`.

### URIs geradas por essa camada

A ferramenta `configure_saml_sso` emite os valores exatos. O formato canônico do Supabase é:

```
ACS URL:    https://<project-ref>.supabase.co/auth/v1/sso/saml/acs
Entity ID:  https://<project-ref>.supabase.co/auth/v1/sso/saml/metadata
```

Vou obter o valor real do projeto no momento da configuração — não vou inventar/colar aqui.

---

## O que muda no código do app

Arquivos afetados (todos front-end + 1 config server):

- `src/components/SapLoginForm.tsx` — substituir form por botão SSO + fallback super-admin.
- `src/pages/AdminLogin.tsx` — idem para backoffice.
- `src/hooks/useAuth.ts` — tratar sessão SSO (já é `session` do Supabase, mudança mínima).
- `src/contexts/SapContext.tsx` — usar email da sessão Okta como `userName` do SAP.
- Nada em edge functions muda — elas já validam JWT do Supabase; SAML emite o mesmo JWT.

---

## O que **não** vai neste plano

- Não vou instalar/derrubar Cloudflare Access — isso é operação de infra.
- Não vou implementar OIDC puro (fora de SAML) porque Supabase Auth não expõe isso como provider gerenciado.
- Não vou migrar autenticação SAP/OMIE em si — continua com o mesmo caminho após o login SSO.

---

## Entregáveis desta task

1. URI de callback do CF Zero Trust para o admin colar no Okta agora (acima).
2. Chamar `configure_saml_sso` para gerar ACS URL + Entity ID reais do projeto e abrir o formulário guiado.
3. Refactor dos dois formulários de login para SSO-first com fallback super-admin.
4. Ajuste do `SapContext` para consumir identidade Okta.

## Preciso de você para continuar

- Confirmar a rota do edge: **manter Cloudflare Zero Trust trocando o IdP para Okta**, ou migrar para **Okta Access Gateway**?
- Team name do Cloudflare Zero Trust (para eu fechar o callback exato acima).
- Lista de domínios de email corporativos que devem ser roteados para Okta (para o passo SAML).
