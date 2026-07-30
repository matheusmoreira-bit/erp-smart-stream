
-- 1. Canonical key function
CREATE OR REPLACE FUNCTION public.canonical_user_key(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        translate(
          lower(split_part(btrim(coalesce(_value, '')), '@', 1)),
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        ),
        '[._\-[:space:]]?(ext|externo|terceiro|adm|admin)$', '', 'g'
      ),
      '[^a-z0-9]', '', 'g'
    ), '');
$$;

-- 2. Directory tables
CREATE TABLE IF NOT EXISTS public.sap_user_directory (
  user_key text PRIMARY KEY,
  sap_user_code text,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sap_user_directory TO authenticated;
GRANT ALL ON public.sap_user_directory TO service_role;
ALTER TABLE public.sap_user_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "directory readable by authenticated" ON public.sap_user_directory;
CREATE POLICY "directory readable by authenticated"
  ON public.sap_user_directory FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "directory managed by admins" ON public.sap_user_directory;
CREATE POLICY "directory managed by admins"
  ON public.sap_user_directory FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.sap_user_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key text NOT NULL REFERENCES public.sap_user_directory(user_key) ON DELETE CASCADE,
  email text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS idx_sap_user_emails_key ON public.sap_user_emails(user_key);

GRANT SELECT ON public.sap_user_emails TO authenticated;
GRANT ALL ON public.sap_user_emails TO service_role;
ALTER TABLE public.sap_user_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user emails readable by authenticated" ON public.sap_user_emails;
CREATE POLICY "user emails readable by authenticated"
  ON public.sap_user_emails FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "user emails managed by admins" ON public.sap_user_emails;
CREATE POLICY "user emails managed by admins"
  ON public.sap_user_emails FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_sap_user_directory_updated
  BEFORE UPDATE ON public.sap_user_directory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sap_user_emails_updated
  BEFORE UPDATE ON public.sap_user_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Backup before dedupe
CREATE TABLE IF NOT EXISTS public.user_identity_migration_backup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.user_identity_migration_backup TO service_role;
ALTER TABLE public.user_identity_migration_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "identity backup admin only" ON public.user_identity_migration_backup;
CREATE POLICY "identity backup admin only"
  ON public.user_identity_migration_backup FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.user_identity_migration_backup (source_table, payload)
SELECT 'user_group_assignments', jsonb_agg(to_jsonb(t)) FROM public.user_group_assignments t
HAVING count(*) > 0;
INSERT INTO public.user_identity_migration_backup (source_table, payload)
SELECT 'approver_cost_centers', jsonb_agg(to_jsonb(t)) FROM public.approver_cost_centers t
HAVING count(*) > 0;

-- 4. Seed directory from known sources
INSERT INTO public.sap_user_directory (user_key, sap_user_code, display_name)
SELECT DISTINCT ON (k) k, code, name FROM (
  SELECT public.canonical_user_key(sap_user_code) AS k,
         sap_user_code AS code,
         coalesce(nullif(btrim(sap_user_name), ''), nullif(btrim(idp_display_name), '')) AS name
  FROM public.idp_user_mapping WHERE public.canonical_user_key(sap_user_code) IS NOT NULL
  UNION ALL
  SELECT public.canonical_user_key(user_code), user_code, nullif(btrim(display_name), '')
  FROM public.collaborator_profiles WHERE public.canonical_user_key(user_code) IS NOT NULL
  UNION ALL
  SELECT public.canonical_user_key(user_code), user_code, nullif(btrim(user_name), '')
  FROM public.user_licenses WHERE public.canonical_user_key(user_code) IS NOT NULL
  UNION ALL
  SELECT public.canonical_user_key(sap_email), split_part(sap_email, '@', 1), NULL
  FROM public.user_group_assignments WHERE public.canonical_user_key(sap_email) IS NOT NULL
) s
WHERE k IS NOT NULL
ORDER BY k, (name IS NULL), code
ON CONFLICT (user_key) DO NOTHING;

-- fill missing display names when a better source exists
UPDATE public.sap_user_directory d
SET display_name = s.name
FROM (
  SELECT public.canonical_user_key(sap_user_code) k,
         coalesce(nullif(btrim(sap_user_name), ''), nullif(btrim(idp_display_name), '')) name
  FROM public.idp_user_mapping
) s
WHERE d.user_key = s.k AND s.name IS NOT NULL AND (d.display_name IS NULL OR btrim(d.display_name) = '');

-- 5. Seed emails (N per user)
INSERT INTO public.sap_user_emails (user_key, email)
SELECT DISTINCT ON (email) k, email FROM (
  SELECT public.canonical_user_key(sap_email) k, lower(btrim(sap_email)) email
  FROM public.idp_user_mapping WHERE sap_email LIKE '%@%'
  UNION ALL
  SELECT public.canonical_user_key(idp_email), lower(btrim(idp_email))
  FROM public.idp_user_mapping WHERE idp_email LIKE '%@%'
  UNION ALL
  SELECT public.canonical_user_key(email), lower(btrim(email))
  FROM public.collaborator_profiles WHERE email LIKE '%@%'
  UNION ALL
  SELECT public.canonical_user_key(email), lower(btrim(email))
  FROM public.user_profiles WHERE email LIKE '%@%'
  UNION ALL
  SELECT public.canonical_user_key(sap_email), lower(btrim(sap_email))
  FROM public.user_group_assignments WHERE sap_email LIKE '%@%'
) s
WHERE k IS NOT NULL AND k IN (SELECT user_key FROM public.sap_user_directory)
ON CONFLICT (email) DO NOTHING;

-- 6. Canonicalize + dedupe user_group_assignments
DELETE FROM public.user_group_assignments a
USING public.user_group_assignments b
WHERE a.ctid > b.ctid
  AND public.canonical_user_key(a.sap_email) = public.canonical_user_key(b.sap_email)
  AND a.group_id = b.group_id
  AND a.sap_email IS NOT NULL AND b.sap_email IS NOT NULL;

UPDATE public.user_group_assignments
SET sap_email = public.canonical_user_key(sap_email)
WHERE public.canonical_user_key(sap_email) IS NOT NULL
  AND sap_email <> public.canonical_user_key(sap_email);

-- 7. Canonicalize + dedupe approver_cost_centers
DELETE FROM public.approver_cost_centers a
USING public.approver_cost_centers b
WHERE a.ctid > b.ctid
  AND public.canonical_user_key(a.sap_email) = public.canonical_user_key(b.sap_email)
  AND a.company_db IS NOT DISTINCT FROM b.company_db
  AND a.cost_center IS NOT DISTINCT FROM b.cost_center;

UPDATE public.approver_cost_centers
SET sap_email = public.canonical_user_key(sap_email)
WHERE public.canonical_user_key(sap_email) IS NOT NULL
  AND sap_email <> public.canonical_user_key(sap_email);

-- 8. Enforce canonical identity on future writes
CREATE OR REPLACE FUNCTION public.canonicalize_sap_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sap_email IS NOT NULL AND public.canonical_user_key(NEW.sap_email) IS NOT NULL THEN
    NEW.sap_email := public.canonical_user_key(NEW.sap_email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uga_canonical_email ON public.user_group_assignments;
CREATE TRIGGER trg_uga_canonical_email
  BEFORE INSERT OR UPDATE ON public.user_group_assignments
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_sap_email();

DROP TRIGGER IF EXISTS trg_acc_canonical_email ON public.approver_cost_centers;
CREATE TRIGGER trg_acc_canonical_email
  BEFORE INSERT OR UPDATE ON public.approver_cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_sap_email();

CREATE UNIQUE INDEX IF NOT EXISTS uq_uga_email_group
  ON public.user_group_assignments (sap_email, group_id);
