# Evidências literais da rodada residual

Checkout local sobre ff8676ddb80e; não atribuir os novos trechos ao commit anterior. Hashes no manifesto. Testes e limites em README.md.

## F05: aprovação confirmada

`supabase/functions/accounts-payable-cnab/index.ts:1379`

```
1379:   const { data: approved, error: upErr } = await admin
1380:     .from("accounts_payable_batches")
1381:     .update({ status: "approved", approved_by: actor, approved_at: approvedAt })
1382:     .eq("id", batchId)
1383:     .eq("company_db", companyDb)
1384:     .eq("status", "generated")
1385:     .eq("content_sha256", batch.content_sha256)
1386:     .eq("generated_by", String(batch.generated_by))
1387:     .is("approved_by", null)
1388:     .select("id").maybeSingle();
1389:   if (upErr) throw new Error(`Falha ao aprovar remessa: ${message(upErr)}`);
1390:   if (!approved) throw new Error("A remessa mudou durante a aprovação. Recarregue e confira novamente.");
1391:   await admin.rpc("insert_audit_log", {
1392:     p_action: "accounts_payable_batch_approved",
```

## F05: lote e valor

`supabase/functions/accounts-payable-cnab/index.ts:1549`

```
1549:   const matches = await matchReturn(admin, companyDb, parsed.titles, String(batch.id));
1550:   for (const match of matches) {
1551:     if (!match.item) throw new Error("Retorno contém título que não pertence a esta remessa.");
1552:     if (match.status === "paid" && (!Number.isFinite(match.paymentAmount) || match.paymentAmount <= 0 ||
1553:         Math.abs(roundMoney(match.paymentAmount) - roundMoney(Number(match.item.amount))) > 0.005)) {
1554:       throw new Error("Valor do retorno diverge do valor aprovado. Reconciliação manual necessária.");
1555:     }
1556:   }
1557:   const accountRelation = Array.isArray(batch.accounts_payable_bank_accounts)
```

## F05: reserva sem expiração

`drizzle/migrations/0066_cnab_return_safety.sql:8`

```
   8:   UPDATE public.accounts_payable_batch_items AS item
   9:   SET status = 'sap_processing', sap_error = NULL, updated_at = now()
  10:   WHERE item.id = p_item_id
  11:     AND item.sap_payment_doc_entry IS NULL
  12:     AND item.status IN ('remitted', 'scheduled', 'paid', 'sap_error')
  13:     AND EXISTS (
  14:       SELECT 1 FROM public.accounts_payable_batches AS batch
  15:       WHERE batch.id = item.batch_id AND batch.company_db = item.company_db
  16:         AND batch.approved_by IS NOT NULL AND batch.approved_at IS NOT NULL
  17:         AND batch.status = 'processing'
  18:     )
  19:   RETURNING item.*;
  20: END;
```

## F05: hash revalidado no banco

`drizzle/migrations/0066_cnab_return_safety.sql:48`

```
  48:   IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL AND
  49:     encode(sha256(convert_to(NEW.content, 'UTF8')), 'hex') IS DISTINCT FROM NEW.content_sha256 THEN
  50:     RAISE EXCEPTION 'CNAB content does not match approved hash' USING ERRCODE = '23514';
  51:   END IF;
  52:   IF OLD.return_sha256 IS NOT NULL AND NEW.return_sha256 IS DISTINCT FROM OLD.return_sha256 THEN
```

## F05: pagamento incerto

`supabase/functions/accounts-payable-cnab/index.ts:1663`

```
1663:             // An uncertain POST remains reserved indefinitely. Never free it for retry.
1664:             await admin.from("accounts_payable_batch_items").update({ status: postStarted ? "sap_processing" : "sap_error", sap_error: message(error).slice(0, 1000) }).eq("id", item.id).eq("status", "sap_processing");
1665:             await admin.from("accounts_payable_return_events").update({ processing_status: "sap_error" })
1666:               .eq("return_sha256", returnHash).eq("line_number", match.lineNumber);
1667:             results.push({ reference: match.companyReference, status: postStarted ? "reconciliation_required" : "sap_error", error: message(error) });
1668:           }
```

## F05/F08: transporte

`supabase/functions/_shared/sap-fetch.ts:28`

```
  28:   // Validate origin independently of OData query parameters.
  29:   const endpoint = new URL(url);
  30:   requireHttpsEndpoint(endpoint.origin);
  31:   if (endpoint.username || endpoint.password) throw new Error("Credenciais na URL SAP não são permitidas.");
  32:   const method = (init.method || "GET").toUpperCase();
  33:   // An uncertain write may already have committed. Only reads can be retried here.
  34:   const maxAttempts = ["GET", "HEAD"].includes(method)
  35:     ? Math.min(5, Math.max(1, Math.floor(requestedAttempts) || 1)) : 1;
  36:   let lastErr: unknown;
  37:   for (let attempt = 1; attempt <= maxAttempts; attempt++) {
```

## F08: endpoint explícito

`supabase/functions/_shared/secure-transport.ts:2`

```
   2: export function requireHttpsEndpoint(raw: string | null | undefined): string {
   3:   let url: URL;
   4:   try { url = new URL(String(raw || "").trim()); }
   5:   catch { throw new Error("Configure um endpoint HTTPS válido para a integração ERP."); }
   6:   if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
   7:     throw new Error("A integração ERP exige HTTPS, sem credenciais, query ou fragmento na URL base.");
   8:   }
   9:   return url.toString().replace(/\/+$/, "");
  10: }
```

## F09: prazo absoluto

`supabase/functions/_shared/auth.ts:251`

```
 251:   const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
 252:   if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
 253:     throw new AuthError("Sessão inválida. Entre novamente.", 401);
 254:   }
 255:   const startedAt = await sessionStartedAt(sessionId);
 256:   if (Date.now() - startedAt >= (isAdmin ? ADMIN_SESSION_MAX_MS : USER_SESSION_MAX_MS)) {
 257:     throw new AuthError("Prazo de segurança da sessão encerrado. Saia e entre novamente para continuar.", 401);
 258:   }
```

## F11: empresa real

`supabase/functions/expense-sap-reconcile/index.ts:298`

```
 298:     await authorizeIntegrationCompany(req, caller, "fiscal_audit", db);
 299: 
```

## F12: GET de credenciais

`supabase/functions/_shared/auth.ts:298`

```
 298:   if (fn === "sap-user-credentials" && req.method === "GET") return;
 299:   if (READ_ONLY_IMPERSONATION_FUNCTIONS.has(fn)) return;
 300:   if (!(await isUserImpersonating(userId))) return;
 301:   throw new AuthError(
 302:     "Modo somente leitura: você está atuando como outro usuário. Encerre a impersonação para executar ações.",
 303:     423,
 304:   );
 305: }
```

## F13: partição

`src/lib/expense-queue-persist.ts:61`

```
  61: async function ownerKey(scope: QueueScope, companyDb: string): Promise<{key: string; owner: string} | null> {
  62:   const owner = await getLocalOwnerId();
  63:   return owner && companyDb ? {key: JSON.stringify([owner, companyDb, scope]), owner} : null;
  64: }
```

## F13: resultado tardio

`src/lib/ai-file-cache.ts:63`

```
  63:   if (epoch !== localStateEpoch() || owner !== await getLocalOwnerId()) {
  64:     throw new Error("A sessão mudou durante a leitura do documento. Abra o documento novamente.");
  65:   }
  66:   memCache.set(scopedKey, value);
  67:   return value;
  68: }
```

## F14: WebP

`supabase/functions/_shared/ai-minimize.ts:90`

```
  90:     if (kind !== "EXIF" && kind !== "XMP ") {
  91:       const part = bytes.slice(i, next);
  92:       if (kind === "VP8X") {
  93:         if (length !== 10) throw new Error("Cabeçalho WebP inválido.");
  94:         part[8] &= ~0x0c;
  95:       }
  96:       parts.push(part);
  97:     }
  98:     i = next;
```

## F15: autenticação monitor

`supabase/functions/hana-health-probe/index.ts:169`

```
 169:     try { requireIntegrationService(req); }
 170:     catch { await requireAdmin(req); }
 171:   } catch (error) {
 172:     return authErrorResponse(error, corsHeaders) || new Response(JSON.stringify({ error: "Acesso negado" }), { status: 403, headers: corsHeaders });
 173:   }
 174: 
```
