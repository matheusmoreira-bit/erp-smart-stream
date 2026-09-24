-- F09: privilégio de admin exige segundo fator (aal2) quando quem pergunta é o próprio usuário logado.
-- Chamadas do servidor (sem JWT) passam o usuário explicitamente e são tratadas no código das funções.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
  AND (
    _role <> 'admin'
    OR auth.uid() IS NULL
    OR auth.uid() <> _user_id
    OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  )
$function$;

-- Situação do segundo fator do próprio usuário (para a tela de cadastro/confirmação).
CREATE OR REPLACE FUNCTION public.my_mfa_status()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT jsonb_build_object(
    'requires_mfa', EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'),
    'has_verified_factor', EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified'),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1')
  )
  WHERE auth.uid() IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION public.my_mfa_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_mfa_status() TO authenticated;

-- Início da sessão (para limite de duração), só para o servidor.
CREATE OR REPLACE FUNCTION public.session_started_at(_session_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT created_at FROM auth.sessions WHERE id = _session_id
$function$;
REVOKE ALL ON FUNCTION public.session_started_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_started_at(uuid) TO service_role;

-- Situação de MFA dos administradores (painel/auditoria), só para o servidor.
CREATE OR REPLACE FUNCTION public.admin_mfa_overview()
RETURNS TABLE(user_id uuid, email text, verified_factors int)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT r.user_id, u.email::text,
         (SELECT count(*)::int FROM auth.mfa_factors f WHERE f.user_id = r.user_id AND f.status = 'verified')
  FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
  WHERE r.role = 'admin'
$function$;
REVOKE ALL ON FUNCTION public.admin_mfa_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mfa_overview() TO service_role;