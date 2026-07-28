CREATE TABLE public.gdrive_backup_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  folder_id text,
  folder_name text,
  folder_path text,
  folder_url text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gdrive_backup_settings_singleton_chk CHECK (singleton = true)
);

GRANT SELECT, INSERT, UPDATE ON public.gdrive_backup_settings TO authenticated;
GRANT ALL ON public.gdrive_backup_settings TO service_role;

ALTER TABLE public.gdrive_backup_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view gdrive backup settings"
  ON public.gdrive_backup_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert gdrive backup settings"
  ON public.gdrive_backup_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update gdrive backup settings"
  ON public.gdrive_backup_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_gdrive_backup_settings_updated_at
  BEFORE UPDATE ON public.gdrive_backup_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.gdrive_backup_settings (singleton) VALUES (true);