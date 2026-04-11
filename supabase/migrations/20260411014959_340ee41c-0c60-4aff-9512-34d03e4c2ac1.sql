
-- Add company_db to permission_groups
ALTER TABLE public.permission_groups
ADD COLUMN company_db TEXT;

-- Add company_db to user_group_assignments  
ALTER TABLE public.user_group_assignments
ADD COLUMN company_db TEXT;

-- Drop old unique constraint if it exists and recreate with company_db
ALTER TABLE public.user_group_assignments
DROP CONSTRAINT IF EXISTS user_group_assignments_sap_email_group_id_key;

-- Add new unique constraint: one user can be in one group per company
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_group_company 
ON public.user_group_assignments (sap_email, group_id, company_db);
