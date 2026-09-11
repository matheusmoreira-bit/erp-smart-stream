-- Destinatários de notificação: comparação exata em vez de "contém"
DROP POLICY IF EXISTS notification_dispatch_recipients_select ON public.notification_dispatch_recipients;
CREATE POLICY notification_dispatch_recipients_select ON public.notification_dispatch_recipients
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      public.current_auth_email() <> ''
      AND lower(coalesce(recipient_email, '')) = public.current_auth_email()
    )
    OR (
      public.current_auth_email() <> ''
      AND lower(coalesce(channel_address, '')) = public.current_auth_email()
    )
  );

DROP POLICY IF EXISTS notification_dispatches_select ON public.notification_dispatches;
CREATE POLICY notification_dispatches_select ON public.notification_dispatches
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.notification_dispatch_recipients r
      WHERE r.dispatch_id = notification_dispatches.id
        AND public.current_auth_email() <> ''
        AND (
          lower(coalesce(r.recipient_email, '')) = public.current_auth_email()
          OR lower(coalesce(r.channel_address, '')) = public.current_auth_email()
        )
    )
  );

-- Governança de notificações: listas de e-mails só para administradores
DROP POLICY IF EXISTS notification_governance_select ON public.notification_governance;
CREATE POLICY notification_governance_select ON public.notification_governance
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Contatos de colaboradores: admin ou o próprio registro
DROP POLICY IF EXISTS "Authenticated read collaborator_profiles" ON public.collaborator_profiles;
CREATE POLICY "Authenticated read collaborator_profiles" ON public.collaborator_profiles
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR lower(user_code) IN (
      SELECT lower(m.sap_user_code) FROM public.idp_user_mapping m
      WHERE lower(m.idp_email) = public.current_auth_email()
         OR lower(m.sap_email) = public.current_auth_email()
    )
    OR lower(user_code) = lower(split_part(coalesce(public.current_auth_email(), ''), '@', 1))
  );