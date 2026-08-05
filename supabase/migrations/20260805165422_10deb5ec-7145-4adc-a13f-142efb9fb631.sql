update public.approval_rules r
set criteria = (
  select jsonb_agg(case when c->>'field'='cost_center' and (c->>'value') not like '%\%%'
    then jsonb_set(c,'{operator}','"equal"') else c end order by ord)
  from jsonb_array_elements(r.criteria) with ordinality t(c,ord)
), priority = case when (r.criteria->0->>'value') like '%\%%' then 90 else 100 end
where r.company_db='SBO_ANAGAMING' and r.doc_type='purchase' and r.created_by='matrix-import-ana-2026-08';