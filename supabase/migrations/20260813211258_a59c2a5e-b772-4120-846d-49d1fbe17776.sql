CREATE TABLE public.substitute_notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_identifier TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  in_app BOOLEAN NOT NULL DEFAULT true,
  email BOOLEAN NOT NULL DEFAULT true,
  push BOOLEAN NOT NULL DEFAULT true,
  slack BOOLEAN NOT NULL DEFAULT true,
  min_amount NUMERIC NOT NULL DEFAULT 0,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.substitute_notification_preferences TO authenticated;
GRANT ALL ON public.substitute_notification_preferences TO service_role;

ALTER TABLE public.substitute_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_select" ON public.substitute_notification_preferences
  FOR SELECT TO authenticated
  USING (user_identifier = public.canonical_user_key(public.current_auth_email()) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "own_insert" ON public.substitute_notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_identifier = public.canonical_user_key(public.current_auth_email()));

CREATE POLICY "own_update" ON public.substitute_notification_preferences
  FOR UPDATE TO authenticated
  USING (user_identifier = public.canonical_user_key(public.current_auth_email()))
  WITH CHECK (user_identifier = public.canonical_user_key(public.current_auth_email()));

CREATE POLICY "own_delete" ON public.substitute_notification_preferences
  FOR DELETE TO authenticated
  USING (user_identifier = public.canonical_user_key(public.current_auth_email()));

CREATE TRIGGER update_substitute_notification_preferences_updated_at
  BEFORE UPDATE ON public.substitute_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();