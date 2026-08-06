ALTER TABLE public.sap_user_directory
  DROP CONSTRAINT IF EXISTS sap_user_directory_management_segment_chk;

ALTER TABLE public.sap_user_directory
  ADD CONSTRAINT sap_user_directory_management_segment_chk
  CHECK (management_segment IN ('gestao_1','gestao_2','csc','betbet','donald'));