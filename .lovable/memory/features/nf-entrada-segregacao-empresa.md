---
name: NF de Entrada segregada por empresa
description: Notas do Master Tax só aparecem na empresa cuja base SAP capturou a nota e cujo CNPJ é o do tomador/destinatário.
type: feature
---

## Regra
- `nf_entrada_imports` guarda `cnpj_destinatario`/`nome_destinatario` (tomador do Master Tax).
- A tela de NF de Entrada lista apenas `sap_company_db = session.companyDB` e, quando a empresa tem `tax_id`, apenas notas cujo `cnpj_destinatario` bate com esse CNPJ.
- Sem empresa ativa, a lista fica vazia (nunca mistura bases, ex.: TST - ANA Gaming x ANA Gaming).
- Dedupe do `mastertax-pull` é por `chave_acesso` + `sap_company_db`.

## Status
- O status exibido é DERIVADO (`src/lib/nf-entrada-status.ts`): sem_pedido → pedido_erpflow → pc_no_sap → esboco_nf → nf_lancada, mais recusada/erro/cancelada, cada um com "Próxima ação".
