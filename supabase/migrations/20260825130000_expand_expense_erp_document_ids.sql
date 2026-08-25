-- Omie uses 64-bit identifiers (for example, nCodPed can exceed 2^31 - 1).
-- SAP DocEntry values remain fully compatible with bigint.
ALTER TABLE public.expenses
  ALTER COLUMN sap_doc_entry TYPE bigint USING sap_doc_entry::bigint,
  ALTER COLUMN sap_doc_num TYPE bigint USING sap_doc_num::bigint;
