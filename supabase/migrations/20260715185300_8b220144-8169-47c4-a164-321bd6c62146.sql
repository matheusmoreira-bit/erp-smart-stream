
-- Garante GRANTs (Data API) para as três tabelas novas
GRANT SELECT, INSERT, UPDATE, DELETE ON public.baixas_recebimento TO authenticated;
GRANT ALL ON public.baixas_recebimento TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.baixas_recebimento_itens TO authenticated;
GRANT ALL ON public.baixas_recebimento_itens TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_venda_erp TO authenticated;
GRANT ALL ON public.pedidos_venda_erp TO service_role;

-- Trigger para setar criado_por = auth.uid() no INSERT quando o cliente não enviar
CREATE OR REPLACE FUNCTION public.set_baixa_criado_por()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.criado_por IS NULL THEN
    NEW.criado_por := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_baixa_criado_por_trigger ON public.baixas_recebimento;
CREATE TRIGGER set_baixa_criado_por_trigger
BEFORE INSERT ON public.baixas_recebimento
FOR EACH ROW EXECUTE FUNCTION public.set_baixa_criado_por();
