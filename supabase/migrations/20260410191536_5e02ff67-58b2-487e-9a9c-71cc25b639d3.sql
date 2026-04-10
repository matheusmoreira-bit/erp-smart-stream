
ALTER TABLE public.companies
ADD COLUMN targets jsonb NOT NULL DEFAULT '{
  "requisicao": 2,
  "cotacao": 3,
  "aprovacao": 3,
  "pedido_compra": 3,
  "nf_entrada": 2,
  "pagamento": 5,
  "aprovador": 1
}'::jsonb;
