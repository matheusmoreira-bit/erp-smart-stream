
-- Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_identifier text NOT NULL,
  company_db text,
  title text NOT NULL,
  body text,
  category text NOT NULL DEFAULT 'system',
  is_read boolean NOT NULL DEFAULT false,
  link text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read their own (matched by identifier via app logic)
CREATE POLICY "Authenticated can read notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins full access notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anon can insert notifications"
  ON public.notifications FOR INSERT TO anon
  WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_notifications_user ON public.notifications (user_identifier, is_read, created_at DESC);

-- Notification preferences table
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_identifier text NOT NULL,
  category text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_identifier, category)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read notification_preferences"
  ON public.notification_preferences FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can manage own preferences"
  ON public.notification_preferences FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
