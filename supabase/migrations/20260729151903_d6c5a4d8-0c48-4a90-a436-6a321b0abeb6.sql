CREATE TABLE public.nfse_email_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL UNIQUE,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  smtp_host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_user TEXT NOT NULL,
  smtp_password_secret TEXT NOT NULL,
  reply_to TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfse_email_settings TO authenticated;
GRANT ALL ON public.nfse_email_settings TO service_role;
ALTER TABLE public.nfse_email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfse_email_settings_select" ON public.nfse_email_settings
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "nfse_email_settings_admin_write" ON public.nfse_email_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.nfse_email_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  project_code TEXT NOT NULL DEFAULT '',
  brand TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, project_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfse_email_recipients TO authenticated;
GRANT ALL ON public.nfse_email_recipients TO service_role;
ALTER TABLE public.nfse_email_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfse_email_recipients_select" ON public.nfse_email_recipients
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "nfse_email_recipients_admin_write" ON public.nfse_email_recipients
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.nfse_email_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  expense_id UUID,
  invoice_doc_entry INTEGER,
  nfse_number TEXT,
  project_code TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  attachment_path TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  sent_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.nfse_email_log TO authenticated;
GRANT ALL ON public.nfse_email_log TO service_role;
ALTER TABLE public.nfse_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nfse_email_log_select" ON public.nfse_email_log
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_nfse_email_settings_updated
  BEFORE UPDATE ON public.nfse_email_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_nfse_email_recipients_updated
  BEFORE UPDATE ON public.nfse_email_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_nfse_email_log_company ON public.nfse_email_log (company_db, created_at DESC);
CREATE INDEX idx_nfse_email_log_expense ON public.nfse_email_log (expense_id);