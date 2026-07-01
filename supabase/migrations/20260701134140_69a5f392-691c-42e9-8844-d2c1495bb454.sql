GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_rules TO authenticated;
GRANT ALL ON public.approval_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_rule_levels TO authenticated;
GRANT ALL ON public.approval_rule_levels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;