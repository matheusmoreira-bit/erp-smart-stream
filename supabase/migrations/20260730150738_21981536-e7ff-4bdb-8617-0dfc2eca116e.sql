UPDATE public.pagcorp_integration_log SET settlement_payment_doc_entry = v.new_entry, settlement_payment_doc_num = v.new_num, updated_at = now()
FROM (VALUES
  (3206, 3417, 2605),
  (3329, 3419, 2606),
  (3325, 3421, 2607),
  (3315, 3422, 2608),
  (3313, 3423, 2609),
  (3284, 3425, 2610),
  (3283, 3426, 2611),
  (3281, 3427, 2612)
) AS v(old_entry, new_entry, new_num)
WHERE public.pagcorp_integration_log.company_db = 'SBO_CACTUS'
  AND public.pagcorp_integration_log.settlement_payment_doc_entry = v.old_entry;