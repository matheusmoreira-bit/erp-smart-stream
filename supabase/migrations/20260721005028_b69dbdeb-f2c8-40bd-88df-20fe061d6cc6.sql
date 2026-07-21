
-- Perfil unificado do colaborador (cross-company)
CREATE TABLE IF NOT EXISTS public.collaborator_profiles (
  user_code text PRIMARY KEY,
  display_name text,
  avatar_url text,
  email text,
  phone text,
  notify_whatsapp_overdue boolean NOT NULL DEFAULT true,
  notify_whatsapp_approvals boolean NOT NULL DEFAULT true,
  notify_email_overdue boolean NOT NULL DEFAULT true,
  notify_email_approvals boolean NOT NULL DEFAULT true,
  sap_synced_at timestamptz,
  dismissed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collaborator_profiles_user_code_lower CHECK (user_code = lower(user_code))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaborator_profiles TO authenticated;
GRANT SELECT ON public.collaborator_profiles TO anon;
GRANT ALL ON public.collaborator_profiles TO service_role;

ALTER TABLE public.collaborator_profiles ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer autenticado (necessário para watchers e resolver aprovadores).
CREATE POLICY "Read collaborator_profiles"
  ON public.collaborator_profiles FOR SELECT
  TO anon, authenticated
  USING (true);

-- Escrita: admins tudo; usuário só o próprio (via idp_user_mapping ou match de email).
CREATE POLICY "Admins manage collaborator_profiles"
  ON public.collaborator_profiles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users upsert own collaborator_profile"
  ON public.collaborator_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(user_code) = lower(split_part(coalesce(auth.jwt() ->> 'email',''), '@', 1))
  );

CREATE POLICY "Users update own collaborator_profile"
  ON public.collaborator_profiles FOR UPDATE
  TO authenticated
  USING (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(user_code) = lower(split_part(coalesce(auth.jwt() ->> 'email',''), '@', 1))
  )
  WITH CHECK (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(user_code) = lower(split_part(coalesce(auth.jwt() ->> 'email',''), '@', 1))
  );

CREATE TRIGGER update_collaborator_profiles_updated_at
  BEFORE UPDATE ON public.collaborator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: consolida melhor valor por user_code a partir de user_profiles + user_phones.
INSERT INTO public.collaborator_profiles (
  user_code, display_name, avatar_url, email, phone,
  notify_whatsapp_overdue, notify_whatsapp_approvals,
  notify_email_overdue, notify_email_approvals,
  sap_synced_at, dismissed_until
)
SELECT
  lower(uc) AS user_code,
  (array_remove(array_agg(display_name  ORDER BY updated_at DESC NULLS LAST), NULL))[1],
  (array_remove(array_agg(avatar_url    ORDER BY updated_at DESC NULLS LAST), NULL))[1],
  (array_remove(array_agg(email         ORDER BY updated_at DESC NULLS LAST), NULL))[1],
  (array_remove(array_agg(phone         ORDER BY updated_at DESC NULLS LAST), NULL))[1],
  bool_or(notify_whatsapp_overdue),
  bool_or(notify_whatsapp_approvals),
  bool_or(notify_email_overdue),
  bool_or(notify_email_approvals),
  max(sap_synced_at),
  max(dismissed_until)
FROM (
  SELECT user_code AS uc, display_name, avatar_url, email, phone,
         notify_whatsapp_overdue, notify_whatsapp_approvals,
         notify_email_overdue, notify_email_approvals,
         sap_synced_at, dismissed_until, updated_at
  FROM public.user_profiles
  UNION ALL
  SELECT user_code, NULL, NULL, NULL, phone,
         true, true, true, true,
         NULL::timestamptz, NULL::timestamptz, updated_at
  FROM public.user_phones
) t
GROUP BY lower(uc)
ON CONFLICT (user_code) DO NOTHING;

-- Trigger: propaga telefone para user_phones em todas as empresas onde o user_code existe (sap_cache).
CREATE OR REPLACE FUNCTION public.sync_collab_phone_to_companies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := NULLIF(btrim(coalesce(NEW.phone, '')), '');
BEGIN
  IF v_phone IS NULL THEN
    DELETE FROM public.user_phones WHERE lower(user_code) = NEW.user_code;
    RETURN NEW;
  END IF;

  -- Empresas conhecidas para este user_code, via sap_cache OU registros já existentes.
  WITH companies AS (
    SELECT DISTINCT company_db FROM public.sap_cache
     WHERE lower(data ->> 'UserCode') = NEW.user_code
    UNION
    SELECT DISTINCT company_db FROM public.user_phones
     WHERE lower(user_code) = NEW.user_code
    UNION
    SELECT DISTINCT company_db FROM public.user_profiles
     WHERE lower(user_code) = NEW.user_code
  )
  INSERT INTO public.user_phones (company_db, user_code, phone, source)
  SELECT c.company_db, NEW.user_code, v_phone, 'manual'
  FROM companies c
  ON CONFLICT (company_db, user_code) DO UPDATE
    SET phone = EXCLUDED.phone,
        source = 'manual',
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collab_profile_phone_sync ON public.collaborator_profiles;
CREATE TRIGGER collab_profile_phone_sync
  AFTER INSERT OR UPDATE OF phone ON public.collaborator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_collab_phone_to_companies();

-- Executa uma vez para propagar telefones já consolidados no backfill.
UPDATE public.collaborator_profiles SET phone = phone WHERE phone IS NOT NULL;
