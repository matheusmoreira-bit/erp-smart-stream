UPDATE public.approval_rules r
SET criteria = (
  SELECT jsonb_agg(
    CASE
      WHEN c->>'operator' = 'like'
      THEN jsonb_set(c, '{value}', to_jsonb(
             regexp_replace(regexp_replace(btrim(c->>'value'), '^%\s+', '%'), '\s+%$', '%')
           ))
      ELSE c
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(to_jsonb(r.criteria)) WITH ORDINALITY AS t(c, ord)
),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(to_jsonb(r.criteria)) c
  WHERE c->>'operator' = 'like' AND (c->>'value') ~ '(^%\s)|(\s%$)'
);