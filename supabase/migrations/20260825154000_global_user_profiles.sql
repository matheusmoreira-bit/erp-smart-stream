-- User contact data is global. Company scope remains only on access controls,
-- licenses, groups and ERP-specific state.

DROP TRIGGER IF EXISTS collab_profile_phone_sync ON public.collaborator_profiles;

DROP TABLE IF EXISTS _global_collaborator_profiles;
CREATE TEMP TABLE _global_collaborator_profiles AS
WITH sources AS (
  SELECT
    user_code,
    display_name,
    avatar_url,
    email,
    phone,
    notify_whatsapp_overdue,
    notify_whatsapp_approvals,
    notify_email_overdue,
    notify_email_approvals,
    sap_synced_at,
    dismissed_until,
    created_at,
    updated_at,
    0 AS source_priority
  FROM public.collaborator_profiles

  UNION ALL

  SELECT
    user_code,
    display_name,
    avatar_url,
    email,
    phone,
    notify_whatsapp_overdue,
    notify_whatsapp_approvals,
    notify_email_overdue,
    notify_email_approvals,
    sap_synced_at,
    dismissed_until,
    created_at,
    updated_at,
    1 AS source_priority
  FROM public.user_profiles

  UNION ALL

  SELECT
    user_code,
    NULL::text,
    NULL::text,
    NULL::text,
    phone,
    true,
    true,
    true,
    true,
    NULL::timestamptz,
    NULL::timestamptz,
    created_at,
    updated_at,
    2 AS source_priority
  FROM public.user_phones

  UNION ALL

  SELECT
    user_data ->> 'UserCode',
    user_data ->> 'UserName',
    NULL::text,
    COALESCE(user_data ->> 'eMail', user_data ->> 'EMail', user_data ->> 'E_Mail'),
    NULL::text,
    true,
    true,
    true,
    true,
    NULL::timestamptz,
    NULL::timestamptz,
    cache.created_at,
    cache.updated_at,
    3 AS source_priority
  FROM public.sap_cache AS cache
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(cache.data) = 'array' THEN cache.data
      ELSE jsonb_build_array(cache.data)
    END
  ) AS user_data
  WHERE NULLIF(user_data ->> 'UserCode', '') IS NOT NULL
), keyed AS (
  SELECT
    COALESCE(public.canonical_user_key(user_code), lower(btrim(user_code))) AS user_key,
    *
  FROM sources
  WHERE NULLIF(btrim(user_code), '') IS NOT NULL
)
SELECT
  user_key AS user_code,
  (array_agg(NULLIF(btrim(display_name), '') ORDER BY source_priority, updated_at DESC)
    FILTER (WHERE NULLIF(btrim(display_name), '') IS NOT NULL))[1] AS display_name,
  (array_agg(NULLIF(btrim(avatar_url), '') ORDER BY source_priority, updated_at DESC)
    FILTER (WHERE NULLIF(btrim(avatar_url), '') IS NOT NULL))[1] AS avatar_url,
  (array_agg(lower(NULLIF(btrim(email), '')) ORDER BY source_priority, updated_at DESC)
    FILTER (WHERE NULLIF(btrim(email), '') IS NOT NULL))[1] AS email,
  (array_agg(NULLIF(btrim(phone), '') ORDER BY source_priority, updated_at DESC)
    FILTER (WHERE NULLIF(btrim(phone), '') IS NOT NULL))[1] AS phone,
  (array_agg(notify_whatsapp_overdue ORDER BY source_priority, updated_at DESC))[1] AS notify_whatsapp_overdue,
  (array_agg(notify_whatsapp_approvals ORDER BY source_priority, updated_at DESC))[1] AS notify_whatsapp_approvals,
  (array_agg(notify_email_overdue ORDER BY source_priority, updated_at DESC))[1] AS notify_email_overdue,
  (array_agg(notify_email_approvals ORDER BY source_priority, updated_at DESC))[1] AS notify_email_approvals,
  max(sap_synced_at) AS sap_synced_at,
  max(dismissed_until) AS dismissed_until,
  min(created_at) AS created_at,
  max(updated_at) AS updated_at
FROM keyed
WHERE user_key IS NOT NULL
GROUP BY user_key;

DELETE FROM public.collaborator_profiles;

INSERT INTO public.collaborator_profiles (
  user_code,
  display_name,
  avatar_url,
  email,
  phone,
  notify_whatsapp_overdue,
  notify_whatsapp_approvals,
  notify_email_overdue,
  notify_email_approvals,
  sap_synced_at,
  dismissed_until,
  created_at,
  updated_at
)
SELECT
  user_code,
  display_name,
  avatar_url,
  email,
  phone,
  COALESCE(notify_whatsapp_overdue, true),
  COALESCE(notify_whatsapp_approvals, true),
  COALESCE(notify_email_overdue, true),
  COALESCE(notify_email_approvals, true),
  sap_synced_at,
  dismissed_until,
  COALESCE(created_at, now()),
  COALESCE(updated_at, now())
FROM _global_collaborator_profiles;

DROP TABLE _global_collaborator_profiles;

CREATE OR REPLACE FUNCTION public.canonicalize_collaborator_profile_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_code := public.canonical_user_key(NEW.user_code);
  IF NEW.user_code IS NULL THEN
    RAISE EXCEPTION 'Identidade do colaborador inválida';
  END IF;
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(NULLIF(btrim(NEW.email), ''));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canonicalize_collaborator_profile_key ON public.collaborator_profiles;
CREATE TRIGGER canonicalize_collaborator_profile_key
  BEFORE INSERT OR UPDATE OF user_code, email ON public.collaborator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_collaborator_profile_key();

CREATE UNIQUE INDEX IF NOT EXISTS collaborator_profiles_canonical_user_unique
  ON public.collaborator_profiles (public.canonical_user_key(user_code));

CREATE OR REPLACE FUNCTION public.sync_collab_phone_to_companies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.canonical_user_key(NEW.user_code);
  v_phone text := NULLIF(btrim(coalesce(NEW.phone, '')), '');
BEGIN
  -- Existing company-scoped profile rows remain as compatibility mirrors.
  UPDATE public.user_profiles
  SET display_name = NEW.display_name,
      avatar_url = NEW.avatar_url,
      email = NEW.email,
      phone = v_phone,
      notify_whatsapp_overdue = NEW.notify_whatsapp_overdue,
      notify_whatsapp_approvals = NEW.notify_whatsapp_approvals,
      notify_email_overdue = NEW.notify_email_overdue,
      notify_email_approvals = NEW.notify_email_approvals,
      sap_synced_at = NEW.sap_synced_at,
      dismissed_until = NEW.dismissed_until,
      updated_at = now()
  WHERE public.canonical_user_key(user_code) = v_key;

  WITH identities AS (
    SELECT cache.company_db, user_data ->> 'UserCode' AS user_code, 1 AS priority
    FROM public.sap_cache AS cache
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(cache.data) = 'array' THEN cache.data
        ELSE jsonb_build_array(cache.data)
      END
    ) AS user_data
    WHERE public.canonical_user_key(user_data ->> 'UserCode') = v_key
      AND NULLIF(user_data ->> 'UserCode', '') IS NOT NULL
    UNION ALL
    SELECT company_db, user_code, 2
    FROM public.user_profiles
    WHERE public.canonical_user_key(user_code) = v_key
    UNION ALL
    SELECT company_db, user_code, 3
    FROM public.user_phones
    WHERE public.canonical_user_key(user_code) = v_key
  ), targets AS (
    SELECT DISTINCT ON (company_db) company_db, user_code
    FROM identities
    WHERE NULLIF(btrim(company_db), '') IS NOT NULL
      AND NULLIF(btrim(user_code), '') IS NOT NULL
    ORDER BY company_db, priority
  )
  INSERT INTO public.user_profiles (
    company_db,
    user_code,
    display_name,
    avatar_url,
    email,
    phone,
    notify_whatsapp_overdue,
    notify_whatsapp_approvals,
    notify_email_overdue,
    notify_email_approvals,
    sap_synced_at,
    dismissed_until
  )
  SELECT
    company_db,
    user_code,
    NEW.display_name,
    NEW.avatar_url,
    NEW.email,
    v_phone,
    NEW.notify_whatsapp_overdue,
    NEW.notify_whatsapp_approvals,
    NEW.notify_email_overdue,
    NEW.notify_email_approvals,
    NEW.sap_synced_at,
    NEW.dismissed_until
  FROM targets
  ON CONFLICT (company_db, user_code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      notify_whatsapp_overdue = EXCLUDED.notify_whatsapp_overdue,
      notify_whatsapp_approvals = EXCLUDED.notify_whatsapp_approvals,
      notify_email_overdue = EXCLUDED.notify_email_overdue,
      notify_email_approvals = EXCLUDED.notify_email_approvals,
      sap_synced_at = EXCLUDED.sap_synced_at,
      dismissed_until = EXCLUDED.dismissed_until,
      updated_at = now();

  IF v_phone IS NULL THEN
    DELETE FROM public.user_phones
    WHERE public.canonical_user_key(user_code) = v_key;
  ELSE
    UPDATE public.user_phones
    SET phone = v_phone,
        source = 'manual',
        updated_at = now()
    WHERE public.canonical_user_key(user_code) = v_key;

    WITH identities AS (
      SELECT cache.company_db, user_data ->> 'UserCode' AS user_code, 1 AS priority
      FROM public.sap_cache AS cache
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(cache.data) = 'array' THEN cache.data
          ELSE jsonb_build_array(cache.data)
        END
      ) AS user_data
      WHERE public.canonical_user_key(user_data ->> 'UserCode') = v_key
        AND NULLIF(user_data ->> 'UserCode', '') IS NOT NULL
      UNION ALL
      SELECT company_db, user_code, 2
      FROM public.user_profiles
      WHERE public.canonical_user_key(user_code) = v_key
      UNION ALL
      SELECT company_db, user_code, 3
      FROM public.user_phones
      WHERE public.canonical_user_key(user_code) = v_key
    ), targets AS (
      SELECT DISTINCT ON (company_db) company_db, user_code
      FROM identities
      WHERE NULLIF(btrim(company_db), '') IS NOT NULL
        AND NULLIF(btrim(user_code), '') IS NOT NULL
      ORDER BY company_db, priority
    )
    INSERT INTO public.user_phones (company_db, user_code, phone, source)
    SELECT company_db, user_code, v_phone, 'manual'
    FROM targets
    ON CONFLICT (company_db, user_code) DO UPDATE
    SET phone = EXCLUDED.phone,
        source = 'manual',
        updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER collab_profile_phone_sync
  AFTER INSERT OR UPDATE OF
    display_name,
    avatar_url,
    email,
    phone,
    notify_whatsapp_overdue,
    notify_whatsapp_approvals,
    notify_email_overdue,
    notify_email_approvals,
    sap_synced_at,
    dismissed_until
  ON public.collaborator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_collab_phone_to_companies();

-- Populate compatibility tables after consolidating all historical records.
UPDATE public.collaborator_profiles SET phone = phone;
