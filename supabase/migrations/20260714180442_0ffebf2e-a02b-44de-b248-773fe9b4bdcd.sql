-- Corrige linha de cache local que "reservou" um CardCode que na verdade
-- pertence a outro Business Partner no SAP (F000259 = NUCLEO DE INFORMACAO
-- em open_gaming_sa, mas o cache apontava para MATEUS BEZERRA porque o
-- SAP rejeitou a criação com "Assign business partner to at least one branch").
UPDATE public.suppliers
   SET card_code = NULL,
       sap_sync_status = 'error',
       sap_sync_error = COALESCE(sap_sync_error, '') ||
         ' [CardCode F000259 divergente — pertence a outro BP no SAP; recadastrar]'
 WHERE id = '3efd6841-d839-453d-a653-00368f21be41';