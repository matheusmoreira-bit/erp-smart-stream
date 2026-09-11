-- Cadastra os gatilhos do motor para todos os eventos emitidos pelo sistema.
INSERT INTO public.notification_triggers (name, event_key, source_module, description, active)
SELECT v.name, v.event_key, v.source_module, v.description, true
FROM (VALUES
  ('Documento aguardando aprovação', 'document.pending_approval', 'approvals', 'Documento de compra/despesa enviado para a alçada de um aprovador.'),
  ('Pedido de venda aguardando aprovação', 'sales_order.pending_approval', 'approvals', 'Pedido de venda enviado para aprovação.'),
  ('Aprovação transferida', 'approval.transferred', 'approvals', 'Aprovação pendente transferida para outro aprovador.'),
  ('Substituto de alçada definido', 'approval.substitute_assigned', 'approvals', 'Substituto de aprovação criado.'),
  ('Substituição de alçada encerrada', 'approval.substitute_revoked', 'approvals', 'Substituto de aprovação revogado.'),
  ('Baixa de cartão pendente', 'cards.settlement_pending', 'cards', 'NF de cartão corporativo aguardando baixa manual.'),
  ('Degradação de integração', 'integration.health_degraded', 'integration', 'Painel de saúde detectou degradação em uma integração.'),
  ('Usuário desprovisionado no IdP', 'identity.user_deprovisioned', 'identity', 'Usuário desligado no IdP; alçadas podem ficar órfãs.'),
  ('Venda — pedido aprovado', 'sales.approved', 'sales', 'Pedido de venda aprovado.'),
  ('Venda — NFS-e emitida', 'sales.nfse_issued', 'sales', 'NFS-e emitida.'),
  ('Venda — NFS-e enviada ao cliente', 'sales.nfse_emailed', 'sales', 'NFS-e enviada por e-mail ao cliente.'),
  ('Venda — baixa registrada', 'sales.nfse_settled', 'sales', 'Baixa de NFS-e registrada.'),
  ('Venda — aguardando aprovação', 'sales.approval_pending', 'sales', 'Marco de vendas: pedido aguardando aprovação.')
) AS v(name, event_key, source_module, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_triggers t
  WHERE t.event_key = v.event_key AND t.company_db IS NULL
);

-- A regra semente duplicaria a notificação in-app já enviada pelo fluxo legado
-- de aprovação; fica desativada até um admin configurar canais próprios.
UPDATE public.notification_rules
SET active = false, updated_at = now()
WHERE name = 'Notificar aprovador atual' AND active = true;