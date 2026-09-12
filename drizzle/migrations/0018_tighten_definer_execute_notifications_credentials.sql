-- 1) Revoke EXECUTE from signed-in users on SECURITY DEFINER functions the app
--    never calls from the browser (internal/trigger/automation only).
--    None of these are referenced by any RLS policy expression.
REVOKE EXECUTE ON FUNCTION public.detect_duplicate_sap_purchase_orders(integer) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.get_default_expense_approver(text) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.kyp_default_company_config() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.nfse_recipients_max_brands() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.notification_config_audit() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.registration_requests_audit() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_notification_recipient(text, text, jsonb) FROM authenticated, anon;

-- 2) notifications: normalize identifiers consistently between insert and read
DROP POLICY IF EXISTS "Users insert own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;

CREATE POLICY "Users insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  lower(btrim(user_identifier)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  OR lower(btrim(user_identifier)) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
  OR lower(btrim(user_identifier)) = lower((auth.uid())::text)
);

CREATE POLICY "Users read own notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  lower(btrim(user_identifier)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  OR lower(btrim(user_identifier)) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
  OR lower(btrim(user_identifier)) = lower((auth.uid())::text)
);

-- 3) system_credentials: explicit allowlist of non-secret metadata keys
DROP POLICY IF EXISTS system_credentials_select_nonsecret ON public.system_credentials;

CREATE POLICY system_credentials_select_nonsecret
ON public.system_credentials
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND lower(credential_key) = ANY (ARRAY[
    'api_base_url',
    'base_url',
    'cnpj',
    'company_db',
    'default_branch_id',
    'empresa_id',
    'hana_api_url',
    'hana_api_v2',
    'integrate_attachments',
    'is_mtp',
    'org_url',
    'pagcorp_payment_account',
    'service_layer_url',
    'use_hana_db',
    'use_hana_v2'
  ])
);