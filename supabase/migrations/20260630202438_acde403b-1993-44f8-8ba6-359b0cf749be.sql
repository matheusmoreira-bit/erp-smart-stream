
-- 1. Consolidate assignments to global (one row per sap_email + group_id)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY lower(sap_email), group_id ORDER BY created_at) AS rn
    FROM public.user_group_assignments
)
DELETE FROM public.user_group_assignments
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE public.user_group_assignments
   SET company_db = NULL,
       sap_email = lower(sap_email)
 WHERE company_db IS NOT NULL OR sap_email <> lower(sap_email);

-- 2. Drop old unique (if any) and add global unique constraint
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.user_group_assignments'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE 'ALTER TABLE public.user_group_assignments DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END$$;

ALTER TABLE public.user_group_assignments
  ADD CONSTRAINT user_group_assignments_email_group_unique
  UNIQUE (sap_email, group_id);
