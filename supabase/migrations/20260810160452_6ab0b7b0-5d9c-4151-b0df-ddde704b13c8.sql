CREATE TABLE public.user_tour_state (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_tour_state TO authenticated;
GRANT ALL ON public.user_tour_state TO service_role;

ALTER TABLE public.user_tour_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own tour state" ON public.user_tour_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own tour state" ON public.user_tour_state
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own tour state" ON public.user_tour_state
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own tour state" ON public.user_tour_state
  FOR DELETE TO authenticated USING (user_id = auth.uid());