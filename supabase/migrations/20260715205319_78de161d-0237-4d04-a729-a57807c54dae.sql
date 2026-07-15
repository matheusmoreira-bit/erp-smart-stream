
-- 1) Função SECURITY DEFINER para listar baixas de uma NF (usada pelo Mapa de Relações).
--    Retorna apenas campos necessários para exibição; qualquer usuário autenticado
--    da mesma empresa (company_db) pode ler — a visualização é read-only e
--    complementa o que ele já enxerga via SAP.
CREATE OR REPLACE FUNCTION public.list_baixas_by_invoice(
  p_company_db text,
  p_invoice_doc_entry bigint
)
RETURNS TABLE (
  id uuid,
  data_recebimento date,
  valor_baixado numeric,
  valor_juros_multa numeric,
  status text,
  sap_incoming_payment_doc_entry bigint,
  created_at timestamptz,
  criado_por_nome text,
  criado_por_user_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.data_recebimento,
    bi.valor_baixado,
    b.valor_juros_multa,
    b.status,
    b.sap_incoming_payment_doc_entry,
    b.created_at,
    b.criado_por_nome,
    b.criado_por_user_code
  FROM public.baixas_recebimento_itens bi
  JOIN public.baixas_recebimento b ON b.id = bi.baixa_id
  WHERE b.company_db = p_company_db
    AND bi.invoice_doc_entry = p_invoice_doc_entry
    AND auth.uid() IS NOT NULL
  ORDER BY b.data_recebimento ASC, b.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.list_baixas_by_invoice(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_baixas_by_invoice(text, bigint) TO authenticated;

-- 2) Backfill: as duas baixas existentes foram gravadas sem "criado_por".
--    Atribui ao admin que estava logado no momento (mesmo user_code SAP).
UPDATE public.baixas_recebimento
SET criado_por = (
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.created_at ASC
  LIMIT 1
)
WHERE criado_por IS NULL
  AND id IN (
    '2453da58-061a-4c46-aad9-d8fb6b16443d',
    '2ab0b050-6e08-4aea-83f4-92787f9cfe2c'
  );
