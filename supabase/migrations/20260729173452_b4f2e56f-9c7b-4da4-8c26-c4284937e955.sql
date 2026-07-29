ALTER TABLE public.registration_request_events
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.can_access_registration_attachment(_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF public.is_registration_agent() THEN
    RETURN true;
  END IF;
  BEGIN
    v_id := ((string_to_array(_object_name, '/'))[1])::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN EXISTS (
    SELECT 1 FROM public.registration_requests r
    WHERE r.id = v_id
      AND lower(r.requester_email) = public.current_auth_email()
  );
END;
$$;

DROP POLICY IF EXISTS "registration attachments select" ON storage.objects;
CREATE POLICY "registration attachments select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'registration-attachments' AND public.can_access_registration_attachment(name));

DROP POLICY IF EXISTS "registration attachments insert" ON storage.objects;
CREATE POLICY "registration attachments insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'registration-attachments' AND public.can_access_registration_attachment(name));

DROP POLICY IF EXISTS "registration attachments delete" ON storage.objects;
CREATE POLICY "registration attachments delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'registration-attachments' AND public.can_access_registration_attachment(name));