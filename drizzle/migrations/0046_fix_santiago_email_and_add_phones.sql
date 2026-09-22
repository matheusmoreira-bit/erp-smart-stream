UPDATE public.sap_user_emails SET is_primary = true, updated_at = now()
WHERE user_key = 'santiagomacedo' AND email = 'santiago.macedo@opengaming.com.br';

INSERT INTO public.user_phones (company_db, user_code, phone, source)
SELECT c.db, v.user_code, v.phone, 'manual'
FROM (VALUES
  ('robson.luiz', '+447310177903'),
  ('fernanda.faria', '+5531971762393')
) AS v(user_code, phone)
CROSS JOIN (VALUES ('SBO_ANAGAMING'),('SBO_CACTUS'),('SBO_INSTITUTO_ANA'),('cactus_providers'),('open_gaming_sa')) AS c(db)
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_phones p
  WHERE lower(p.user_code) = v.user_code AND p.company_db = c.db
);