update public.approval_rules
set criteria = '[
  {"field":"item_groups","group":0,"operator":"like","value":"169"},
  {"field":"item.any","group":0,"logic":"either","operator":"like","value":"IMP%"},
  {"field":"rateio_type","group":0,"logic":"either","operator":"equal","value":"imposto"},
  {"field":"total_amount","group":1,"groupLogic":"and","operator":"less_than","value":"100000"}
]'::jsonb,
    updated_at = now()
where id = '55fcd467-c68d-4047-8ea1-ed422b21412d';