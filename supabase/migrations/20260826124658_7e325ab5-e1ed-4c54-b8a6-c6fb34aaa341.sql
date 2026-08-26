CREATE POLICY "Users insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  user_identifier = (auth.jwt() ->> 'email')
  OR user_identifier = split_part((auth.jwt() ->> 'email'), '@', 1)
  OR user_identifier = (auth.uid())::text
);

GRANT SELECT, INSERT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;