CREATE TABLE IF NOT EXISTS public.standalone_mode (
  company_db text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  reason text,
  ends_at timestamptz,
  snapshot_at timestamptz,
  snapshot_summary jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.standalone_mode TO authenticated;
GRANT ALL ON public.standalone_mode TO service_role;

ALTER TABLE public.standalone_mode ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado precisa saber se a empresa está em
-- modo standalone (banners, bloqueio de ações de integração nas telas).
-- Não há dado sensível na linha; anon não recebe GRANT nem policy.
CREATE POLICY standalone_mode_select_authenticated
  ON public.standalone_mode FOR SELECT TO authenticated
  USING (true);

-- Escrita: somente administradores (validado no servidor).
CREATE POLICY standalone_mode_insert_admin
  ON public.standalone_mode FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY standalone_mode_update_admin
  ON public.standalone_mode FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY standalone_mode_delete_admin
  ON public.standalone_mode FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));