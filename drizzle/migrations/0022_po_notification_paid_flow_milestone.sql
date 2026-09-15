ALTER TABLE public.po_notification_sent DROP CONSTRAINT IF EXISTS po_notif_milestone_check;
ALTER TABLE public.po_notification_sent
  ADD CONSTRAINT po_notif_milestone_check
  CHECK (milestone IN ('approved','grpo','ap_invoice','ap_paid','paid_flow'));

ALTER TABLE public.po_notification_sent DROP CONSTRAINT IF EXISTS po_notif_unique;
CREATE UNIQUE INDEX IF NOT EXISTS po_notif_unique_recipient
  ON public.po_notification_sent (company_db, po_doc_entry, milestone, coalesce(recipient_email, ''));