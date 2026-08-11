CREATE OR REPLACE FUNCTION public.api_key_register_use(_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_keys
  SET use_count = use_count + 1, last_used_at = now()
  WHERE id = _id;
$$;

REVOKE ALL ON FUNCTION public.api_key_register_use(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_register_use(UUID) TO service_role;