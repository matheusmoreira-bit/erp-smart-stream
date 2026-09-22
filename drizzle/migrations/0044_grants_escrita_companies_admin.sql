-- Telas administrativas gravam em companies; a RLS ("Admins full access")
-- continua sendo a barreira real de autorização.
GRANT INSERT, UPDATE, DELETE ON public.companies TO authenticated;