ALTER TABLE public.sap_user_directory
  ADD COLUMN IF NOT EXISTS management_segment text NOT NULL DEFAULT 'gestao_1';

ALTER TABLE public.sap_user_directory
  ADD CONSTRAINT sap_user_directory_management_segment_chk
  CHECK (management_segment IN ('gestao_1','gestao_2'));

CREATE INDEX IF NOT EXISTS idx_sap_user_directory_mgmt
  ON public.sap_user_directory (management_segment);