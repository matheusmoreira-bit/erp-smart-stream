UPDATE public.pagcorp_integration_log SET settlement_payment_doc_entry = v.new_entry, settlement_payment_doc_num = v.new_num, updated_at = now()
FROM (VALUES
  (14177, 14261, 10805),
  (14175, 14263, 10806),
  (14173, 14265, 10807),
  (14050, 14266, 10808),
  (14026, 14268, 10809),
  (13817, 14269, 10810),
  (13723, 14270, 10811)
) AS v(old_entry, new_entry, new_num)
WHERE public.pagcorp_integration_log.company_db = 'SBO_ANAGAMING'
  AND public.pagcorp_integration_log.settlement_payment_doc_entry = v.old_entry;