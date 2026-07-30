CREATE TABLE public.approval_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  approver_email text NOT NULL,
  approver_name text,
  level_order integer,
  channel text NOT NULL DEFAULT 'email',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_action text,
  used_ip text,
  used_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX approval_action_tokens_expense_idx ON public.approval_action_tokens (expense_id);
CREATE INDEX approval_action_tokens_expires_idx ON public.approval_action_tokens (expires_at);

GRANT ALL ON public.approval_action_tokens TO service_role;

ALTER TABLE public.approval_action_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_action_tokens_no_client_access"
ON public.approval_action_tokens
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);