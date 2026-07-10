GRANT SELECT ON public.pagcorp_document_relations TO authenticated;
GRANT ALL ON public.pagcorp_document_relations TO service_role;

GRANT SELECT ON public.sap_purchase_order_cache TO authenticated;
GRANT ALL ON public.sap_purchase_order_cache TO service_role;

GRANT SELECT ON public.sap_vendor_payment_cache TO authenticated;
GRANT ALL ON public.sap_vendor_payment_cache TO service_role;

GRANT SELECT ON public.sap_purchase_order_sync_state TO authenticated;
GRANT ALL ON public.sap_purchase_order_sync_state TO service_role;

GRANT SELECT ON public.sap_vendor_payment_sync_state TO authenticated;
GRANT ALL ON public.sap_vendor_payment_sync_state TO service_role;