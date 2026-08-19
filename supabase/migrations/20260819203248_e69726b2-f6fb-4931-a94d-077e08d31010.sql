update public.expense_attachments
set file_name = 'GuiaPagamento_57920261000147_180820261424316386 INN.pdf'
where expense_id = '04a42fc9-17c1-4d29-b36e-c5c2d135eb2e';

update public.sap_retry_queue
set status = 'pending', attempts = 0, notified_exhausted_at = null,
    next_attempt_at = now() - interval '1 minute',
    last_error = 'Reprocessamento manual após correção do nome do anexo'
where id = '3e733965-73ac-484f-a964-cf74c103cd8e';

update public.expenses
set sap_attachment_status = null, sap_integration_error = null, sap_integration_locked_at = null
where id = '04a42fc9-17c1-4d29-b36e-c5c2d135eb2e';