-- Melhora os templates de notificação (e-mail, WhatsApp e in-app).
-- O envelope visual do e-mail é aplicado pelo worker; os templates guardam
-- apenas o conteúdo interno.

UPDATE public.notification_templates
SET subject_template = '[ERP Flow] {{title}}',
    body_template = '{{summary}}

Empresa: {{company_name}}
Fornecedor/Cliente: {{supplier_name}}
Valor: {{amount_label}}
Solicitante: {{requester_name}}
Aprovador: {{approver_name}}',
    html_template = '<p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155">{{summary}}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;border-left:4px solid #0f766e;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a"><tr><td style="padding:8px 16px"><strong style="color:#334155">Empresa:</strong> {{company_name}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">Fornecedor/Cliente:</strong> {{supplier_name}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">Valor:</strong> {{amount_label}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">Solicitante:</strong> {{requester_name}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">Aprovador:</strong> {{approver_name}}</td></tr></table>',
    updated_at = now(),
    updated_by = 'system:template-refresh'
WHERE name = 'E-mail padrão ERP Flow';

UPDATE public.notification_templates
SET subject_template = '[ERP Flow] {{title}}',
    body_template = 'Uma nota fiscal de cartão corporativo está aguardando baixa no ERP Flow.

Pedido de compra: {{po_doc_num}}
NF de entrada: {{invoice_doc_num}}
Fornecedor: {{vendor_name}}
Valor: {{amount}} {{currency}}',
    html_template = '<p style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155">Uma nota fiscal de cartão corporativo está aguardando baixa no ERP Flow.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;border-left:4px solid #0f766e;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a"><tr><td style="padding:8px 16px"><strong style="color:#334155">Pedido de compra:</strong> {{po_doc_num}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">NF de entrada:</strong> {{invoice_doc_num}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">Fornecedor:</strong> {{vendor_name}}</td></tr><tr><td style="padding:8px 16px"><strong style="color:#334155">Valor:</strong> {{amount}} {{currency}}</td></tr></table>',
    updated_at = now(),
    updated_by = 'system:template-refresh'
WHERE name = 'E-mail — baixa de cartão pendente';

UPDATE public.notification_templates
SET subject_template = 'ERP Flow — {{title}}',
    body_template = '{{summary}}

🏢 Empresa: {{company_name}}
🤝 Fornecedor/Cliente: {{supplier_name}}
💰 Valor: {{amount_label}}
🙋 Solicitante: {{requester_name}}

Acesse o ERP Flow para ver os detalhes e concluir a ação.',
    updated_at = now(),
    updated_by = 'system:template-refresh'
WHERE name = 'WhatsApp padrão ERP Flow';

UPDATE public.notification_templates
SET subject_template = 'Aprovação pendente — {{document_number}}',
    body_template = '{{supplier_name}} · {{currency}} {{amount}} aguarda a aprovação de {{approver_name}}.',
    updated_at = now(),
    updated_by = 'system:template-refresh'
WHERE name = 'Aprovação pendente';

UPDATE public.notification_templates
SET subject_template = 'Falha de integração — {{source_module}}',
    body_template = '{{message}}',
    updated_at = now(),
    updated_by = 'system:template-refresh'
WHERE name = 'Falha de integração';

-- Template de WhatsApp específico para baixa de cartão.
INSERT INTO public.notification_templates (name, description, channel, subject_template, body_template, active)
SELECT 'WhatsApp — baixa de cartão pendente',
       'Aviso de NF de cartão corporativo aguardando baixa.',
       'whatsapp',
       'ERP Flow — {{title}}',
       'Há uma nota fiscal de cartão corporativo aguardando baixa.

🧾 NF de entrada: {{invoice_doc_num}}
📄 Pedido de compra: {{po_doc_num}}
🤝 Fornecedor: {{vendor_name}}
💰 Valor: {{amount}} {{currency}}

Acesse Cartões › Baixas no ERP Flow para concluir.',
       true
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates WHERE name = 'WhatsApp — baixa de cartão pendente'
);
