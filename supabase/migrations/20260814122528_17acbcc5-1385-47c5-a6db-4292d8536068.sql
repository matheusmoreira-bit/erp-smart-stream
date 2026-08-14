DELETE FROM public.nf_entrada_settings
 WHERE company_db = 'SBO_ANAGAMING'
   AND (key LIKE 'mastertax_last_pull:%' OR key = 'last_pull_iso');