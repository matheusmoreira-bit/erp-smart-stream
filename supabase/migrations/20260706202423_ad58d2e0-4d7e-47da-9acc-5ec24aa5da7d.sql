
CREATE TABLE public.approver_substitutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT,
  official_email TEXT NOT NULL,
  official_name TEXT,
  substitute_email TEXT NOT NULL,
  substitute_name TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  granted_by_id UUID,
  granted_by_email TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by_id UUID,
  revoked_by_email TEXT,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approver_substitutes_period_chk CHECK (ends_at > starts_at),
  CONSTRAINT approver_substitutes_different_chk CHECK (lower(official_email) <> lower(substitute_email))
);

CREATE INDEX idx_approver_substitutes_substitute_email ON public.approver_substitutes (lower(substitute_email));
CREATE INDEX idx_approver_substitutes_official_email ON public.approver_substitutes (lower(official_email));
CREATE INDEX idx_approver_substitutes_active ON public.approver_substitutes (starts_at, ends_at) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approver_substitutes TO authenticated;
GRANT ALL ON public.approver_substitutes TO service_role;

ALTER TABLE public.approver_substitutes ENABLE ROW LEVEL SECURITY;

-- Admins gerenciam tudo
CREATE POLICY "Admins gerenciam substituicoes"
  ON public.approver_substitutes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Envolvidos (oficial ou substituto) podem visualizar suas próprias linhas
CREATE POLICY "Envolvidos podem visualizar sua substituicao"
  ON public.approver_substitutes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
        AND (
          lower(u.email) = lower(approver_substitutes.official_email)
          OR lower(u.email) = lower(approver_substitutes.substitute_email)
          OR lower(split_part(u.email, '@', 1)) = lower(approver_substitutes.official_email)
          OR lower(split_part(u.email, '@', 1)) = lower(approver_substitutes.substitute_email)
        )
    )
  );

-- updated_at trigger
CREATE TRIGGER trg_approver_substitutes_updated_at
  BEFORE UPDATE ON public.approver_substitutes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auditoria imutável em cadeia (append-only via audit_trail)
SELECT public.enable_audit_on('approver_substitutes');

-- Helper: para um email de substituto, devolve os emails dos oficiais com substituicao ativa
CREATE OR REPLACE FUNCTION public.active_officials_for_substitute(_substitute_identifier TEXT)
RETURNS TABLE(official_email TEXT, official_name TEXT, id UUID, ends_at TIMESTAMPTZ, company_db TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.official_email, s.official_name, s.id, s.ends_at, s.company_db
  FROM public.approver_substitutes s
  WHERE s.revoked_at IS NULL
    AND s.starts_at <= now()
    AND s.ends_at   >  now()
    AND (
      lower(s.substitute_email) = lower(_substitute_identifier)
      OR lower(split_part(s.substitute_email, '@', 1)) = lower(_substitute_identifier)
    );
$$;

GRANT EXECUTE ON FUNCTION public.active_officials_for_substitute(TEXT) TO authenticated, anon, service_role;
