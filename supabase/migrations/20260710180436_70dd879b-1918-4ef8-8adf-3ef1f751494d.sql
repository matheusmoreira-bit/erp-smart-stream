-- 1) Granularidade CRUD em permission_group_modules
ALTER TABLE public.permission_group_modules
  ADD COLUMN IF NOT EXISTS can_view   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_create BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_edit   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT true;

-- 2) Consolidar Aprovador -> Usuário
DO $$
DECLARE
  v_aprovador_id UUID;
  v_usuario_id   UUID;
BEGIN
  SELECT id INTO v_aprovador_id
    FROM public.permission_groups
   WHERE lower(name) = 'aprovador'
   ORDER BY created_at ASC
   LIMIT 1;

  SELECT id INTO v_usuario_id
    FROM public.permission_groups
   WHERE lower(name) = 'usuário' OR lower(name) = 'usuario'
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_aprovador_id IS NULL THEN
    RETURN;
  END IF;

  -- Se não existe grupo Usuário, renomeia o Aprovador para Usuário e termina.
  IF v_usuario_id IS NULL THEN
    UPDATE public.permission_groups
       SET name = 'Usuário',
           description = COALESCE(description, 'Acesso padrão — fluxo operacional + aprovações')
     WHERE id = v_aprovador_id;
    RETURN;
  END IF;

  -- Une módulos do Aprovador nos módulos do Usuário (OR nas flags CRUD).
  INSERT INTO public.permission_group_modules
    (group_id, module_key, can_view, can_create, can_edit, can_delete)
  SELECT v_usuario_id, apm.module_key,
         apm.can_view, apm.can_create, apm.can_edit, apm.can_delete
    FROM public.permission_group_modules apm
   WHERE apm.group_id = v_aprovador_id
  ON CONFLICT (group_id, module_key) DO UPDATE
    SET can_view   = public.permission_group_modules.can_view   OR EXCLUDED.can_view,
        can_create = public.permission_group_modules.can_create OR EXCLUDED.can_create,
        can_edit   = public.permission_group_modules.can_edit   OR EXCLUDED.can_edit,
        can_delete = public.permission_group_modules.can_delete OR EXCLUDED.can_delete;

  -- Move atribuições de usuário (evita colisão via delete-then-update).
  DELETE FROM public.user_group_assignments a
   WHERE a.group_id = v_aprovador_id
     AND EXISTS (
       SELECT 1 FROM public.user_group_assignments b
        WHERE b.group_id = v_usuario_id
          AND lower(b.sap_email) = lower(a.sap_email)
     );

  UPDATE public.user_group_assignments
     SET group_id = v_usuario_id
   WHERE group_id = v_aprovador_id;

  -- Remove os módulos do Aprovador e o próprio grupo.
  DELETE FROM public.permission_group_modules WHERE group_id = v_aprovador_id;
  DELETE FROM public.permission_groups WHERE id = v_aprovador_id;
END $$;