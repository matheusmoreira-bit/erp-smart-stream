-- Repara instalações que ainda mantêm a unicidade legada por usuário + grupo.
-- A regra atual é uma atribuição por usuário canônico em cada empresa.
DO $$
DECLARE
  constraint_name text;
  index_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_group_assignments'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.user_group_assignments DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;

  FOR index_name IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'user_group_assignments'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
      AND indexname <> 'user_group_assignments_pkey'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', index_name);
  END LOOP;
END $$;

UPDATE public.user_group_assignments
SET sap_email = public.canonical_user_key(sap_email)
WHERE public.canonical_user_key(sap_email) IS NOT NULL
  AND sap_email IS DISTINCT FROM public.canonical_user_key(sap_email);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY public.canonical_user_key(sap_email), COALESCE(company_db, '')
      ORDER BY created_at DESC, id DESC
    ) AS position
  FROM public.user_group_assignments
)
DELETE FROM public.user_group_assignments
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX user_group_assignments_email_company_unique
  ON public.user_group_assignments (
    public.canonical_user_key(sap_email),
    COALESCE(company_db, '')
  );
