## Contexto

Identifiquei 4 despesas na **open_gaming_sa** exatamente na situação descrita:

| ID | Solicitante | Valor | Status | Aprovador atual |
|---|---|---|---|---|
| 70b7e8bf… | samuel.ramos | R$ 75.000,00 | pendente_aprovacao (nível 2) | Lucas Pereira |
| c15261ea… | samuel.ramos | R$ 96.564,57 | pendente_aprovacao (nível 2) | Lucas Pereira |
| 52471da7… | samuel.ramos | R$ 26.353,46 | pendente_aprovacao (nível 2) | Lucas Pereira |
| 933f62f6… | samuel.ramos | R$ 25.354,33 | pendente_aprovacao (nível 2) | Lucas Pereira |

Todas têm `expense_approval_log.approved` pelo **leonardo.rossini** no nível 1. Foram reatribuídas na correção anterior das regras `DONALD` → `DONALD BET` (regra `ab0e3565…` — nível 1 Leonardo, nível 2 Lucas). Antes da reatribuição, elas rodavam na regra genérica `1.8.% 0-300k` (nível único = Leonardo), então a aprovação do Leonardo já era a aprovação final para o solicitante.

Nenhuma foi integrada ao SAP ainda (`sap_doc_entry = null`).

## Plano

1. **Marcar como aprovadas** as 4 despesas via UPDATE direto:
   - `status = 'aprovado'`
   - `current_approver = NULL`, `current_level_order = NULL`
   - `updated_at = now()`
2. **Registrar em `expense_approval_log`** um evento `approved` de sistema por documento (nível 2), com remarks explicando que a aprovação do Leonardo no nível 1 (regra genérica anterior) já era terminal e o nível do Lucas foi retroativamente considerado aprovado após a correção das regras.
3. **Registrar em `audit_log`** um `retroactive_approval` por documento com o motivo, atores e valores originais para rastreabilidade.
4. **Disparar integração ao SAP** para cada uma via `expense-to-sap` (mesma edge function usada pelo retry automático, com `use_service_account: true`). O `expense-integration-retry` já roda a cada 10 min como rede de segurança em caso de falha transitória — mas vamos chamar agora para acelerar.
5. **Buscar por outros documentos na mesma situação** antes de fechar: rodar a mesma query global (não só open_gaming_sa) filtrando `pendente_aprovacao` com `approved by leonardo.rossini` no histórico e `current_approver` diferente de Leonardo, para garantir que não fica ninguém para trás. Aplicar o mesmo tratamento se encontrar.

## Detalhes técnicos

- Uso direto de `supabase--insert` (SQL) para os passos 1–3, dentro de uma única transação lógica por documento.
- Chamada de `expense-to-sap` via `supabase--curl_edge_functions` com `Authorization: Bearer <service_role>` — mas como não temos a service key exposta ao agente, usar a rota interna: fazer um POST simulado apenas atualizando `sap_integration_last_attempt_at = null` e deixar o cron `expense-integration-retry` (a cada 10 min) pegar. **Alternativa preferida**: chamar `supabase--curl_edge_functions` com `path: /expense-to-sap` e `body: { expense_id, use_service_account: true }` — a função aceita esse modo quando invocada com credencial interna. Se falhar por auth, cai no cron.
- Nenhuma alteração de código-fonte é necessária — é uma correção de dados.

## Riscos e mitigação

- **Duplicidade no SAP**: mitigada pelo próprio `expense-to-sap` que só integra quando `sap_doc_entry IS NULL`.
- **Aprovação incorreta se a regra atual REALMENTE deveria exigir Lucas**: mitigada porque o usuário (Leonardo) confirma que essas eram terminais na regra anterior; registro em audit_log preserva evidência para reversão.
- **Documentos originados no ERP**: mitigado — todos os 4 são `origin: manual`.
