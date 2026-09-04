alter table public.accounts_payable_batches
  add column if not exists content text;

comment on column public.accounts_payable_batches.content
  is 'Conteudo original do arquivo CNAB gerado para permitir download posterior do mesmo lote.';
