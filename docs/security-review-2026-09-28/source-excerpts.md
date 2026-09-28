# Trechos de evidência do código

Commit: `410a28c9081c44a2feefba450736025b61bf75c7`. Linhas do checkout revisado; não representam prova de deploy.

## [supabase/functions/_shared/auth.ts](../../supabase/functions/_shared/auth.ts)

```text
246:     auth: { persistSession: false },
247:   });
248: }
249: 
250: async function hasAdminRole(userId: string): Promise<boolean> {
251:   const hit = adminRoleCache.get(userId);
252:   if (hit && hit.until > Date.now()) return hit.admin;
253:   // Sem JWT no client de serviço: has_role devolve só o papel cadastrado.
254:   const { data, error } = await svcClient().rpc("has_role", { _user_id: userId, _role: "admin" });
255:   const admin = !error && data === true;
256:   if (adminRoleCache.size > 1000) adminRoleCache.clear();
257:   adminRoleCache.set(userId, { until: Date.now() + 60_000, admin });
258:   return admin;
259: }
260: 
261: async function sessionStartedAt(sessionId: string): Promise<number | null> {
262:   const hit = sessionStartCache.get(sessionId);
263:   if (hit && hit.until > Date.now()) return hit.startedAt;
264:   let startedAt: number | null = null;
265:   try {
266:     const { data } = await svcClient().rpc("session_started_at", { _session_id: sessionId });
267:     startedAt = data ? new Date(String(data)).getTime() : null;
268:   } catch { /* falha aberta: não derruba o app por indisponibilidade */ }
269:   if (sessionStartCache.size > 2000) sessionStartCache.clear();
270:   sessionStartCache.set(sessionId, { until: Date.now() + 5 * 60_000, startedAt });
271:   return startedAt;
272: }
273: 
274: async function assertMfaAndSessionAge(req: Request, userId: string) {
275:   const payload = tokenPayload(req);
276:   const aal = String(payload.aal || "aal1");
277:   const isAdmin = await hasAdminRole(userId);
278:   if (isAdmin && aal !== "aal2") {
```

```text
325:       auth: { persistSession: false },
326:     });
327:     const { data, error } = await svc.rpc("is_impersonating", { _user_id: userId });
328:     if (error) throw error;
329:     active = data === true;
330:   } catch (e) {
331:     // Falha fechada só se já sabíamos que estava ativo; senão não derruba o app.
332:     active = hit?.active ?? false;
333:     console.warn("[auth] is_impersonating falhou", e instanceof Error ? e.message : e);
334:   }
335:   if (impersonationCache.size > 1000) impersonationCache.clear();
336:   impersonationCache.set(userId, { until: Date.now() + 10_000, active });
337:   return active;
338: }
339: 
340: async function assertNotImpersonatingWrite(req: Request, userId: string) {
341:   const fn = edgeFunctionName(req);
342:   if (READ_ONLY_IMPERSONATION_FUNCTIONS.has(fn)) return;
343:   if (!(await isUserImpersonating(userId))) return;
344:   throw new AuthError(
345:     "Modo somente leitura: você está atuando como outro usuário. Encerre a impersonação para executar ações.",
346:     423,
347:   );
348: }
349: 
```

```text
539:       const { data } = await svcClient().rpc("has_module_action", {
540:         _user_id: u.id, _company_db: companyDb, _module: moduleKey, _action: "view",
541:       });
542:       if (data === true) return { ...u, source: "cloud_module" as const };
543:     } catch { /* segue para sessão ERP */ }
544: 
545:     const sapAdmin = await validateSapAdmin(req);
546:     if (sapAdmin) return sapAdmin;
547: 
548:     const sap = await validateSapSession(req);
549:     if (!sap?.userName) throw err;
550: 
551:     const admin = createClient(
552:       Deno.env.get("SUPABASE_URL")!,
553:       Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
554:     );
555:     const { data, error } = await admin.rpc("sap_user_has_module", {
556:       _sap_username: sap.userName,
557:       _module_key: moduleKey,
558:     });
559:     if (error || data !== true) {
560:       throw new AuthError("Acesso negado — módulo sem permissão", 403);
561:     }
562:     return { ...sap, source: "sap_module" as const };
563:   }
564: }
565: 
566: export async function requireAdminOrSapSession(req: Request) {
567:   try {
568:     const user = await requireAdmin(req);
569:     return { ...user, source: "cloud_admin" as const };
570:   } catch (err) {
571:     const sap = await validateSapSession(req);
572:     if (sap) return sap;
573:     throw err;
574:   }
575: }
576: 
577: /**
578:  * Lightweight variant: aceita chamador com SAP session declarada, mas
579:  * exige prova — ou (a) token HMAC `x-sap-auth-token` válido (cheap, sem
580:  * network), ou (b) probe do B1 Service Layer via validateSapSession.
581:  * Nunca confia apenas nos headers.
582:  */
583: export async function requireAdminOrSapSessionHeaders(req: Request) {
```

```text
665:   // o SAP confirmar o dono da sessão (UsersService_GetCurrentUser).
666:   sapSessionValidationCache.delete(cacheKey);
667:   console.warn("[validateSapSession] missing/invalid signed SAP token", { companyDB, sapUser });
668:   return null;
669: }
670: 
671: export async function requireUserOrSapSession(req: Request) {
672:   try {
673:     return await requireUser(req);
674:   } catch (err) {
675:     const sap = await validateSapSession(req);
676:     if (sap) return sap;
677:     throw err;
678:   }
679: }
680: 
681: /**
682:  * Lightweight variant of requireUserOrSapSession: exige prova de sessão
683:  * SAP (HMAC token ou probe do B1). Nunca aceita apenas headers.
684:  */
685: export async function requireUserOrSapSessionHeaders(req: Request) {
686:   try {
687:     return await requireUser(req);
688:   } catch (err) {
689:     const sap = await validateSapSession(req);
690:     if (sap) return sap;
691:     throw err;
692:   }
693: }
694: 
695: 
696: export function authErrorResponse(err: unknown, corsHeaders: Record<string, string>) {
697:   if (err instanceof AuthError) {
698:     return new Response(JSON.stringify({ error: err.message }), {
699:       status: err.status,
700:       headers: { ...corsHeaders, "Content-Type": "application/json" },
701:     });
702:   }
703:   return null;
704: }
```

## [supabase/functions/nf-entrada-fetch-file/index.ts](../../supabase/functions/nf-entrada-fetch-file/index.ts)

```text
86: 
87: Deno.serve(async (req) => {
88:   if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
89: 
90:   const supabase = createClient(
91:     Deno.env.get("SUPABASE_URL")!,
92:     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
93:   );
94: 
95:   try {
96:     const body = await req.json().catch(() => ({}));
97:     const importId = String(body?.import_id || "");
98:     const kind = String(body?.kind || "").toLowerCase();
99:     if (!importId || (kind !== "xml" && kind !== "pdf")) {
100:       return new Response(JSON.stringify({ error: "import_id e kind ('xml'|'pdf') obrigatórios" }), {
101:         status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
102:       });
103:     }
104: 
105:     const { data: row } = await supabase
106:       .from("nf_entrada_imports")
107:       .select("id, chave_acesso, sap_company_db, xml_storage_path, pdf_storage_path, raw_mastertax")
108:       .eq("id", importId).maybeSingle();
109:     if (!row) {
110:       return new Response(JSON.stringify({ error: "NF não encontrada" }), {
111:         status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
112:       });
113:     }
114: 
115:     const existingPath = kind === "xml" ? row.xml_storage_path : row.pdf_storage_path;
116:     if (existingPath) {
117:       const { data: signed, error: signErr } = await supabase.storage
118:         .from("nf-entrada-files").createSignedUrl(existingPath, 60 * 10);
119:       if (!signErr && signed?.signedUrl) {
120:         return new Response(JSON.stringify({ url: signed.signedUrl, cached: true }), {
121:           headers: { ...corsHeaders, "Content-Type": "application/json" },
122:         });
123:       }
124:     }
```

## [supabase/functions/credentials/index.ts](../../supabase/functions/credentials/index.ts)

```text
26:     const systemName = url.searchParams.get("system");
27:     let companyDb = url.searchParams.get("company_db");
28:     const includeKeys = url.searchParams.get("keys");
29:     const metadataOnlyGet = req.method === "GET" && !includeKeys;
30:     const caller = metadataOnlyGet
31:       ? await requireAdminOrSapSessionHeaders(req)
32:       : await requireAdminOrSapModule(req, "credentials");
33:     const callerCompanyDb = typeof (caller as { companyDB?: unknown }).companyDB === "string"
34:       ? (caller as { companyDB: string }).companyDB
35:       : null;
36:     if (callerCompanyDb) {
37:       if (companyDb && companyDb !== callerCompanyDb) {
38:         throw new AuthError("Acesso negado para esta empresa", 403);
39:       }
40:       companyDb = callerCompanyDb;
41:     }
```

```text
70:       const { system_name, credentials, company_db } = body as {
71:         system_name: string;
72:         credentials: { key: string; value: string }[];
73:         company_db?: string;
74:       };
75:       const targetCompanyDb = company_db || companyDb || null;
76:       if (callerCompanyDb && targetCompanyDb !== callerCompanyDb) {
77:         throw new AuthError("Acesso negado para esta empresa", 403);
78:       }
79: 
80:       if (!system_name || typeof system_name !== "string" || system_name.length > 100) {
81:         return new Response(JSON.stringify({ error: "system_name inválido" }), {
82:           status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
83:         });
84:       }
85:       if (!Array.isArray(credentials) || credentials.length === 0 || credentials.length > 50) {
86:         return new Response(JSON.stringify({ error: "credentials inválidas" }), {
87:           status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
88:         });
```

```text
110:             { onConflict: "system_name,credential_key,company_db" },
111:           );
112:         if (error) throw error;
113:       }
114: 
115:       return new Response(JSON.stringify({ success: true }), {
116:         headers: { ...corsHeaders, "Content-Type": "application/json" },
117:       });
118:     }
119: 
120:     if (req.method === "DELETE") {
```

## [supabase/functions/accounts-payable-cnab/index.ts](../../supabase/functions/accounts-payable-cnab/index.ts)

```text
1653: Deno.serve(async (req: Request): Promise<Response> => {
1654:   if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
1655:   let auth: Record<string, unknown>;
1656:   try {
1657:     auth = await requireAdminOrSapModule(req, "financial_review") as Record<string, unknown>;
1658:   } catch (error) {
1659:     return authErrorResponse(error, corsHeaders) ?? json({ error: "Acesso negado." }, 403);
1660:   }
1661: 
1662:   try {
1663:     const body = await req.json().catch(() => ({})) as Record<string, unknown>;
1664:     const action = String(body.action || "");
1665:     const companyDb = String(body.company_db || "").trim();
1666:     if (!companyDb) return json({ error: "company_db é obrigatório." }, 400);
1667:     if (auth.companyDB && String(auth.companyDB) !== companyDb) return json({ error: "Empresa divergente da sessão autenticada." }, 403);
1668:     const actor = String(auth.email || auth.userName || auth.id || "unknown");
1669:     const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
1670: 
1671:     if (action === "get_config") return json({ config: await loadBankConfig(admin, companyDb) });
1672:     if (action === "save_config") return json({ config: await saveBankConfig(admin, companyDb, body, actor) });
1673:     if (action === "get_supplier_payment_profile") return json(await getSupplierPaymentProfile(admin, companyDb, body, req));
1674:     if (action === "save_supplier_payment_profile") return json(await saveSupplierPaymentProfile(admin, companyDb, body, actor, req));
1675:     if (action === "list_open") return json({ titles: await listAvailableTitles(admin, companyDb, req, body) });
1676:     if (action === "generate") return json(await generateBatch(admin, companyDb, body, actor, req));
1677:     if (action === "list_batches") return json({ batches: await listBatches(admin, companyDb) });
1678:     if (action === "approve_batch") return json(await approveBatch(admin, companyDb, body, actor));
1679:     if (action === "approve_supplier_payment_profile") return json(await approveSupplierPaymentProfile(admin, companyDb, body, actor, req));
1680:     if (action === "download_batch") return json(await downloadBatch(admin, companyDb, body, actor));
1681:     if (action === "preview_return") return json(await previewReturn(admin, companyDb, String(body.content || "")));
1682:     if (action === "process_return") return json(await processReturn(admin, companyDb, String(body.content || ""), String(body.filename || ""), actor, req));
1683:     return json({ error: "Ação inválida." }, 400);
1684:   } catch (error) {
1685:     console.error("[accounts-payable-cnab]", message(error));
1686:     return json({ error: message(error) }, 500);
1687:   }
```

## [drizzle/migrations/0061_fix_has_module_action_canonical_identity.sql](../../drizzle/migrations/0061_fix_has_module_action_canonical_identity.sql)

```text
20:     RETURN false;
21:   END IF;
22: 
23:   IF public.has_role(_user_id, 'admin') THEN
24:     RETURN true;
25:   END IF;
26: 
27:   IF _company_db IS NOT NULL THEN
28:     SELECT lower(coalesce(erp_type, '')) INTO v_company_type
29:     FROM public.companies WHERE company_db = _company_db LIMIT 1;
30:     IF v_company_type = 'omie' THEN
31:       RETURN true;
32:     END IF;
33:   END IF;
34: 
35:   SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
36:   IF v_email IS NULL THEN
37:     RETURN false;
38:   END IF;
39:   v_user_key := public.canonical_user_key(v_email);
40:   IF coalesce(v_user_key, '') = '' THEN
```

## [drizzle/migrations/0059_user_company_access.sql](../../drizzle/migrations/0059_user_company_access.sql)

```text
36:       -- Lotus Blanca: somente ANA Gaming
37:       ((SELECT e FROM n) NOT LIKE '%@lotusblanca.net' OR (SELECT c FROM n) = 'SBO_ANAGAMING')
38:       AND (
39:         EXISTS (SELECT 1 FROM public.companies co, n WHERE co.company_db = n.c AND lower(coalesce(co.erp_type, '')) = 'omie')
40:         OR EXISTS (SELECT 1 FROM public.user_company_access a, n WHERE lower(a.email) = n.e AND a.company_db = n.c)
41:         OR EXISTS (SELECT 1 FROM public.user_group_assignments uga, n
42:                    WHERE uga.company_db = n.c AND (lower(uga.sap_email) = n.e OR lower(uga.sap_email) = n.l))
43:         OR EXISTS (SELECT 1 FROM public.sap_user_emails s JOIN public.user_licenses ul ON lower(ul.user_code) = lower(s.user_key), n
44:                    WHERE lower(s.email) = n.e AND ul.company_db = n.c)
45:         OR EXISTS (SELECT 1 FROM public.user_licenses ul, n WHERE ul.company_db = n.c AND lower(ul.user_code) = n.l)
46:       )
47:     )
48:   );
49: $function$;
50: REVOKE ALL ON FUNCTION public.user_can_access_company(text, text) FROM PUBLIC, anon, authenticated;
51: GRANT EXECUTE ON FUNCTION public.user_can_access_company(text, text) TO service_role;
```

## [drizzle/migrations/0053_system_credentials_decrypt_view_f06.sql](../../drizzle/migrations/0053_system_credentials_decrypt_view_f06.sql)

```text
1: -- F06 (etapa 1): chave interna fora do schema público + leitura decifrada só para o backend.
2: CREATE SCHEMA IF NOT EXISTS private;
3: REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
4: 
5: CREATE TABLE IF NOT EXISTS private.credential_keyring (
6:   id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
7:   material text NOT NULL,
8:   created_at timestamptz NOT NULL DEFAULT now()
9: );
10: REVOKE ALL ON private.credential_keyring FROM PUBLIC, anon, authenticated, service_role;
11: INSERT INTO private.credential_keyring (id, material)
12: VALUES (1, encode(extensions.gen_random_bytes(48), 'base64'))
13: ON CONFLICT (id) DO NOTHING;
14: 
15: CREATE OR REPLACE FUNCTION public.is_secret_credential_key(_key text)
16: RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
17:   SELECT coalesce(_key, '') ~* '(password|secret|token|private_key|api_key|app_key|aes_key|hmac_key|client_key)'
```

```text
26: CREATE OR REPLACE FUNCTION public.reveal_system_credential(_stored text)
27: RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private, extensions AS $$
28: DECLARE r text;
29: BEGIN
30:   IF _stored IS NULL OR _stored NOT LIKE 'enc:v1:%' THEN RETURN _stored; END IF;
31:   r := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
32:   IF session_user NOT IN ('postgres', 'supabase_admin') AND r <> 'service_role' THEN
33:     RETURN NULL;
34:   END IF;
35:   RETURN extensions.pgp_sym_decrypt(decode(substr(_stored, 8), 'base64'), private.cred_material());
36: END $$;
```

## [drizzle/migrations/0054_system_credentials_encrypt_at_rest_f06.sql](../../drizzle/migrations/0054_system_credentials_encrypt_at_rest_f06.sql)

```text
1: -- F06 (etapa 2): cifra os segredos gravados e todos os novos.
2: CREATE OR REPLACE FUNCTION public.system_credentials_encrypt_trg()
3: RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, extensions AS $$
4: BEGIN
5:   IF public.is_secret_credential_key(NEW.credential_key)
6:      AND NEW.credential_value IS NOT NULL AND NEW.credential_value <> ''
7:      AND NEW.credential_value NOT LIKE 'enc:v1:%' THEN
8:     NEW.credential_value := 'enc:v1:' || encode(
9:       extensions.pgp_sym_encrypt(NEW.credential_value, private.cred_material(), 'cipher-algo=aes256'), 'base64');
10:   END IF;
11:   RETURN NEW;
12: END $$;
13: REVOKE ALL ON FUNCTION public.system_credentials_encrypt_trg() FROM PUBLIC, anon, authenticated;
```

## [supabase/functions/copilot-chat/index.ts](../../supabase/functions/copilot-chat/index.ts)

```text
347: type ToolCtx = { confirmed: boolean; onPending?: (p: { id: string; summary: string; tool: string }) => void };
348: const WRITE_TOOL_NAMES = new Set([
349:   "redirect_approval", "reprocess_sap_integration", "reprocess_pagcorp_settlement",
350:   "revert_expense_to_pending", "send_notification", "toggle_approval_rule", "upsert_approval_rule",
351: ]);
352: let pendingSb: SupabaseClient | null = null;
353: let pendingActor: Actor | null = null;
354: async function requireConfirmation(ctx: ToolCtx, name: string, args: any, summary: string) {
355:   if (!pendingSb || !pendingActor) return { error: "Confirmação indisponível." };
356:   const { confirmed: _ignored, ...cleanArgs } = args || {};
357:   const { data, error } = await pendingSb.from("copilot_pending_actions").insert({
358:     user_id: pendingActor.userId, tool_name: name, args: cleanArgs, summary: summary.slice(0, 1000),
359:   }).select("id").single();
360:   if (error || !data) return { error: "Falha ao registrar ação pendente." };
361:   ctx.onPending?.({ id: data.id, summary, tool: name });
362:   return {
363:     _pending_confirmation: true,
364:     action_id: data.id,
365:     summary,
```

```text
810:     if (!rl.allowed) return rateLimitResponse(rl, { ...corsHeaders, "Content-Type": "application/json" });
811: 
812:     const actor: Actor = { userId: userData.user.id, email: userData.user.email || "" };
813:     pendingSb = sbAdmin;
814:     pendingActor = actor;
815:     const body = await req.json().catch(() => ({})) as Record<string, unknown>;
816: 
817:     // ===== F10: decisão humana sobre ação pendente (não passa pelo modelo) =====
818:     const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
819:     const decideId = typeof body.confirm_action_id === "string" ? body.confirm_action_id
820:       : typeof body.cancel_action_id === "string" ? body.cancel_action_id : null;
821:     if (decideId !== null) {
822:       if (!UUID_RX.test(decideId)) return json({ error: "ID inválido." }, 400);
823:       if (typeof body.confirm_action_id === "string" && await isUserImpersonating(actor.userId)) {
824:         return json({ error: "Modo somente leitura: encerre a impersonação para executar ações." }, 423);
825:       }
826:       const confirming = typeof body.confirm_action_id === "string";
827:       // Consome atomicamente: só o dono, só pendente, só dentro do prazo.
828:       const { data: action } = await sbAdmin.from("copilot_pending_actions")
829:         .update({ status: confirming ? "confirmed" : "cancelled", decided_at: new Date().toISOString() })
830:         .eq("id", decideId).eq("user_id", actor.userId).eq("status", "pending")
831:         .gt("expires_at", new Date().toISOString())
832:         .select("id, tool_name, args, summary").maybeSingle();
833:       if (!action) return json({ error: "Ação não encontrada, já decidida ou expirada (10 min)." }, 409);
834:       if (!confirming) {
835:         await audit(sbAdmin, actor, "copilot.action_cancelled", "copilot_action", action.id, { tool: action.tool_name });
836:         return json({ ok: true, cancelled: true });
837:       }
838:       let result: unknown;
839:       try {
840:         result = await runTool(action.tool_name, action.args, sbAdmin, actor, sbUser, { confirmed: true });
```

## [Makefile](../../Makefile)

```text
36: 	  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $$f; \
37: 	done
38: 
39: qa-shell: ## psql no banco QA
40: 	PGPASSWORD=$$(grep '^POSTGRES_PASSWORD=' docker/.env | cut -d= -f2) \
41: 	psql -h 127.0.0.1 -p 54322 -U postgres -d postgres
42: 
43: help:
44: 	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
45: 	awk 'BEGIN{FS=":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
```

## [supabase/functions/replica-sync/index.ts](../../supabase/functions/replica-sync/index.ts)

```text
15: // Ordem de carga. Começa pela trilha de auditoria.
16: const ID_CURSOR_TABLES = ["audit_trail", "audit_trail_archive"] as const;
17: type SyncTable = typeof ID_CURSOR_TABLES[number];
18: 
19: const BATCH = 1500;
```

```text
28: async function syncTable(src: postgres.Sql, dst: postgres.Sql, table: SyncTable, deadline: number) {
29:   const [{ max }] = await dst`select coalesce(max(id), 0)::bigint as max from ${dst("public." + table)}`;
30:   let cursor = BigInt(max as string | number);
31:   let copied = 0;
32:   let done = false;
33:   while (Date.now() < deadline) {
34:     if (Date.now() >= deadline) break;
35:     // Lote vem pronto como texto JSON do banco — sem parse em JS (limite de CPU da função).
36:     const [b] = await src`
37:       select count(*)::int as n, max(id)::text as last, coalesce(json_agg(t order by id), '[]')::text as payload
38:       from (select * from ${src("public." + table)} where id > ${cursor.toString()} order by id limit ${BATCH}) t`;
39:     const n = b.n as number;
40:     if (n === 0) { done = true; break; }
41:     await dst`
42:       insert into ${dst("public." + table)}
43:       select * from json_populate_recordset(null::${dst("public." + table)}, (${b.payload as string}::text)::json)
44:       on conflict (id) do nothing`;
```

## [scripts/backup-restore.ts](../../scripts/backup-restore.ts)

```text
1: // Restauração de backup ERPBK1 (F07). Executar fora do app, em máquina controlada:
2: //   BACKUP_ENC_KEY=... TARGET_DB_URL=postgres://... deno run -A scripts/backup-restore.ts <pasta-local-com-manifest> [--verify-only]
3: // A pasta deve conter manifest.json e os arquivos *.jsonl.gz.enc baixados do S3.
4: // Restaura somente tabelas do schema public (auth.users é só conferido — contas voltam via convite/SSO).
5: import { gunzipSync } from "node:zlib";
6: import { createHash } from "node:crypto";
7: import postgres from "npm:postgres@3.4.4";
8: 
```

```text
40: for (const t of manifest.tables) {
41:   let n = 0;
42:   for (const p of t.parts) {
43:     const rows = await readPart(k, p);
44:     n += rows.length;
45:     if (sql && t.table !== "auth.users" && rows.length) {
46:       for (let i = 0; i < rows.length; i += 500) {
47:         const batch = rows.slice(i, i + 500);
48:         await sql`INSERT INTO ${sql("public." + t.table)} ${sql(batch)} ON CONFLICT DO NOTHING`;
49:       }
50:     }
51:   }
52:   if (n !== t.count) throw new Error(`${t.table}: esperado ${t.count}, lido ${n}`);
```

## [src/lib/clear-erp-local-state.ts](../../src/lib/clear-erp-local-state.ts)

```text
48: 
49:   // F13: fila offline de despesas e anexos de NF guardados no IndexedDB.
50:   clearUserIndexedDbs();
51: }
52: 
53: const USER_INDEXED_DBS = ["erpflow-offline", "createExpenseModalQueue"];
54: 
55: /** Apaga os bancos locais com dados do usuário. Nunca lança. */
56: export function clearUserIndexedDbs(): void {
57:   try {
58:     if (typeof indexedDB === "undefined") return;
59:     for (const name of USER_INDEXED_DBS) {
60:       try { indexedDB.deleteDatabase(name); } catch { /* ignore */ }
61:     }
62:   } catch { /* ignore */ }
63: }
```

## [supabase/functions/expense-ocr-capture/index.ts](../../supabase/functions/expense-ocr-capture/index.ts)

```text
28: const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);
29: 
30: function approxBytesFromBase64(b64: string): number {
```

```text
103:   // F14: minimização — tira metadados da foto (GPS, aparelho, comentários).
104:   let aiImage = image;
105:   if (parsed.mime === "image/jpeg" || parsed.mime === "image/png") {
106:     try {
107:       const bin = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
108:       const clean = stripImageMetadata(bin, parsed.mime);
109:       let b = "";
110:       for (let i = 0; i < clean.length; i += 8192) b += String.fromCharCode(...clean.subarray(i, i + 8192));
111:       aiImage = `data:${parsed.mime};base64,${btoa(b)}`;
112:     } catch { /* mantém original */ }
113:   }
114: 
115:   const instruction = [
116:     "Você extrai dados de documentos fiscais brasileiros (NF-e, NFS-e, boleto, recibo, cupom).",
```

## [supabase/functions/_shared/ai-minimize.ts](../../supabase/functions/_shared/ai-minimize.ts)

```text
61:   } catch { /* em dúvida, envia o original */ }
62:   return bytes;
63: }
64: 
65: function luhnOk(d: string): boolean {
66:   let sum = 0;
67:   let alt = false;
68:   for (let i = d.length - 1; i >= 0; i--) {
69:     let n = d.charCodeAt(i) - 48;
70:     if (alt) { n *= 2; if (n > 9) n -= 9; }
71:     sum += n;
72:     alt = !alt;
```
