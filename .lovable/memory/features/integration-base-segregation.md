---
name: Integration base segregation
description: Toda integração (PagCorp, NF Entrada, Synapse) deve persistir e filtrar por company_db do contexto SAP ativo, sem vazar entre bases de teste e produção.
type: feature
---

## Regra
- Toda inserção em `pagcorp_integration_log`, `nf_entrada_imports`, `nf_entrada_logs`, `synapse_execution_log` deve gravar `company_db` da empresa ativa (`session.companyDB`).
- Toda query de exibição (IntegrationHistory, IntegrationsMonitor, PagCorp, Approvals, Expenses) deve filtrar por `.eq("company_db", session.companyDB)`.
- Sem `session.companyDB`, NÃO listar nem marcar "integrado" — retorna vazio para evitar vazamento de status entre bases.
- "TST - ANA Gaming" e "ANA Gaming" são bases distintas; o histórico nunca pode ser compartilhado.
