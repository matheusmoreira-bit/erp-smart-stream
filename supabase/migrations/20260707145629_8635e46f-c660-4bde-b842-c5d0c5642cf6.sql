CREATE TABLE IF NOT EXISTS public.overdue_reminder_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  frequency_minutes integer NOT NULL DEFAULT 30 CHECK (frequency_minutes >= 5),
  template text NOT NULL DEFAULT E'⚠️ *Documento vencido aguardando aprovação*\n\nFornecedor: {{supplier}}\nValor: {{currency}} {{amount}}\nVencimento: {{due_date}} (há {{days_overdue}} dia(s))\nSolicitante: {{requester}}\n\nAprove em: {{link}}',
  window_start_hour integer NOT NULL DEFAULT 8 CHECK (window_start_hour BETWEEN 0 AND 23),
  window_end_hour integer NOT NULL DEFAULT 20 CHECK (window_end_hour BETWEEN 1 AND 24),
  weekdays_only boolean NOT NULL DEFAULT true,
  max_reminders_per_doc integer NOT NULL DEFAULT 0,
  notify_approver boolean NOT NULL DEFAULT true,
  notify_requester boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.overdue_reminder_settings TO authenticated;
GRANT ALL ON public.overdue_reminder_settings TO service_role;

ALTER TABLE public.overdue_reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read overdue settings"
  ON public.overdue_reminder_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage overdue settings"
  ON public.overdue_reminder_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.overdue_reminder_settings (company_db)
SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM public.overdue_reminder_settings WHERE company_db IS NULL);

CREATE TABLE IF NOT EXISTS public.overdue_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  recipient_role text NOT NULL CHECK (recipient_role IN ('approver', 'requester')),
  recipient_name text,
  recipient_phone text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'error', 'skipped_no_phone', 'skipped_window', 'skipped_frequency', 'skipped_max')),
  response text
);

CREATE INDEX IF NOT EXISTS idx_overdue_reminder_log_expense ON public.overdue_reminder_log (expense_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_overdue_reminder_log_recent ON public.overdue_reminder_log (sent_at DESC);

GRANT SELECT ON public.overdue_reminder_log TO authenticated;
GRANT ALL ON public.overdue_reminder_log TO service_role;

ALTER TABLE public.overdue_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read overdue log"
  ON public.overdue_reminder_log FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('overdue-reminders-dispatch');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'overdue-reminders-dispatch',
      '*/5 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/overdue-reminders-dispatch',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object('trigger', 'cron')
        ) AS request_id;
      $cron$
    );
  END IF;
END $$;