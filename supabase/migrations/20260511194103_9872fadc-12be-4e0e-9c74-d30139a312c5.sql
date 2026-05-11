ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS slack boolean NOT NULL DEFAULT false;