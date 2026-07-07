
-- Regra de substituição bidirecional entre Leonardo.Rossini e Santiago.Macedo.
-- Ambos ficam autorizados a visualizar e aprovar em nome do outro.
-- Vigência longa (10 anos); pode ser revogada normalmente pela tela de Aprovadores Substitutos.

INSERT INTO public.approver_substitutes
  (official_email, official_name, substitute_email, substitute_name, starts_at, ends_at, reason, granted_by_email)
SELECT
  'leonardo.rossini', 'Leonardo Rossini',
  'santiago.macedo',  'Santiago Macedo',
  now(), now() + interval '10 years',
  'Regra fixa de substituição mútua Leonardo <-> Santiago',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM public.approver_substitutes
  WHERE lower(official_email)  = 'leonardo.rossini'
    AND lower(substitute_email) = 'santiago.macedo'
    AND revoked_at IS NULL
    AND ends_at > now()
);

INSERT INTO public.approver_substitutes
  (official_email, official_name, substitute_email, substitute_name, starts_at, ends_at, reason, granted_by_email)
SELECT
  'santiago.macedo', 'Santiago Macedo',
  'leonardo.rossini','Leonardo Rossini',
  now(), now() + interval '10 years',
  'Regra fixa de substituição mútua Santiago <-> Leonardo',
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM public.approver_substitutes
  WHERE lower(official_email)  = 'santiago.macedo'
    AND lower(substitute_email) = 'leonardo.rossini'
    AND revoked_at IS NULL
    AND ends_at > now()
);
