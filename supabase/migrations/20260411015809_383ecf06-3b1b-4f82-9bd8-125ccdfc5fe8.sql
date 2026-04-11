
-- Add erp_type column to permission_groups
ALTER TABLE public.permission_groups
ADD COLUMN IF NOT EXISTS erp_type TEXT;

-- Migrate existing groups: set erp_type based on their company_db
UPDATE public.permission_groups pg
SET erp_type = c.erp_type
FROM public.companies c
WHERE pg.company_db = c.company_db AND pg.erp_type IS NULL;

-- For any groups without a company_db, default to 'sap'
UPDATE public.permission_groups
SET erp_type = 'sap'
WHERE erp_type IS NULL;

-- Deduplicate groups: keep one per (name, erp_type), remove company-specific duplicates
-- First, reassign user_group_assignments to the surviving group
WITH ranked AS (
  SELECT id, name, erp_type,
    ROW_NUMBER() OVER (PARTITION BY name, erp_type ORDER BY created_at ASC) as rn
  FROM public.permission_groups
),
survivors AS (
  SELECT id, name, erp_type FROM ranked WHERE rn = 1
),
duplicates AS (
  SELECT r.id as dup_id, s.id as survivor_id
  FROM ranked r
  JOIN survivors s ON s.name = r.name AND s.erp_type = r.erp_type
  WHERE r.rn > 1
)
UPDATE public.user_group_assignments uga
SET group_id = d.survivor_id
FROM duplicates d
WHERE uga.group_id = d.dup_id;

-- Delete duplicate permission_group_modules
WITH ranked AS (
  SELECT id, name, erp_type,
    ROW_NUMBER() OVER (PARTITION BY name, erp_type ORDER BY created_at ASC) as rn
  FROM public.permission_groups
),
duplicates AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM public.permission_group_modules WHERE group_id IN (SELECT id FROM duplicates);

-- Delete duplicate groups
WITH ranked AS (
  SELECT id, name, erp_type,
    ROW_NUMBER() OVER (PARTITION BY name, erp_type ORDER BY created_at ASC) as rn
  FROM public.permission_groups
),
duplicates AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM public.permission_groups WHERE id IN (SELECT id FROM duplicates);

-- Add unique constraint: one group name per erp_type
CREATE UNIQUE INDEX IF NOT EXISTS uq_permission_group_erp
ON public.permission_groups (name, erp_type);
