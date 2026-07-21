## Objetivo
Substituir toda a estrutura de regras por Centro de Custo/Projeto da OpenGaming (`open_gaming_sa`) pela nova estrutura consolidada em 32 grupos (18 diretorias). **Não reprocessar** os documentos em aprovação — eles continuam ancorados na regra atual via `expenses.approval_rule_id`.

## Estratégia — mínimo de regras, sem tocar em pendentes

1. **Preservar regras "especiais" existentes** (priority 9999–10000): Impostos (prefixo/grupo), Folha, Reembolso, e a regra "ESPECIAL - Fornecedor F000470 + Item Cactus%". Não são de CC/Projeto e continuam no ar.
2. **Desativar (não deletar)** todas as demais regras de `open_gaming_sa` — as de CC/Projeto (priority ≤ 200), inclusive as já `is_active=false`. Motivo: manter FK `expenses.approval_rule_id` dos pendentes; o pendente continua com a regra antiga apontada, mesmo desativada — a mudança de regra só afeta despesas NOVAS.
3. **Inserir a nova estrutura** conforme o JSON, colapsando faixas com aprovador repetido (AP1 → 300k é uma única faixa por padrão; só 1.8.1.4/DONALD, 1.8.1.8 e 1.10.1.1/2.%/3.% (DONALD), 1.10.4.1-6 quebram em 10k / 100k / 300k).

## Convenção de prioridade (para o resolvedor escolher a regra mais específica primeiro)

- **priority 300** — regras project-scoped (`aprovacao_por_projeto`): 1.8.1.4, 1.9.1.1, 1.10.1.1/2.%/3.%, 1.14.1.1-3
- **priority 200** — regras só por CC (sem filtro de projeto)
- 9999–10000 — regras especiais existentes (Impostos/Folha/Reembolso) — inalteradas

## Formato dos critérios (mantém o padrão atual do projeto)

Cada regra vira 1 linha em `approval_rules` + N linhas em `approval_rule_levels` (uma por faixa/projeto). `criteria` (jsonb) usa o mesmo shape já em produção:
```json
[
  {"field":"cost_center","group":0,"value":"1.X.%","operator":"like"},
  {"field":"project","group":0,"logic":"and","value":"DONALD","operator":"equal"},   // só quando project-scoped
  {"field":"total_amount","group":0,"logic":"and","value":0,"value2":300000,"operator":"between"}
]
```
Para uma lista de CCs (`["1.2.1.1","1.2.4.3","1.2.4.4"]`), gera uma regra por CC (mesmo aprovador/nome) ou usa `like` quando cabe (`1.2.3.%`, `1.4.%`, `1.5.%`, `1.7.%`, `1.12.%`, `1.13.%`, `1.80.%`, `1.81.%`, `1.99.%`, `1.10.5.%`, `1.10.2.%`, `1.10.3.%`, `1.1.%`).

## Normalizações e ressalvas
- Corrigir typo do payload: **"Santago Macedo" → "Santiago Macedo"** (1.14.1.1-3 DONALD).
- Aprovadores usam os e-mails já cadastrados no projeto (todos os 17 constam em `approval_rule_levels`).
- Faixas do payload são semi-abertas (`valor_min` inclusive, `valor_max` inclusive/próximo topo). Vou padronizar com `between` `[0, 10000]`, `[10000.01, 100000]`, `[100000.01, 300000]`, `[300000.01, NULL→∞]` (usando `min_value/max_value` como no restante das regras da base).
- `1.100.1` (CARTÕES) fica como `equal` (não tem `%`).

## Total esperado de regras novas
~84 linhas em `approval_rules` (uma por faixa × projeto × CC agrupável). Reduz drasticamente vs. as ~50+ regras ativas + inativas hoje só para 1.8 e 1.10, e agora cobre as 18 diretorias.

## Passos de execução (build mode)

1. **Migration SQL única** (`supabase--migration`):
   - `UPDATE approval_rules SET is_active=false WHERE company_db='open_gaming_sa' AND priority<=200;`
   - `INSERT` das novas regras + `INSERT` dos níveis correspondentes em `approval_rule_levels`.
   - Envolvido em uma transação; sem tocar em `expenses`.
2. **Validação pós-deploy** (`supabase--read_query`):
   - Conferir quantidade de regras ativas por diretoria.
   - Rodar `check_applicable_approval_rules` para 3-4 combinações (ex.: `1.10.4.1 + DONALD + 5k → Leonardo`; `1.8.1.4 + DONALD + 200k → Santiago`; `1.14.1.1 + DONALD + 50k → Santiago`; `1.5.1.3 + qualquer + 1k → Ketlhenn`).
   - Confirmar que despesas pendentes continuam apontando para as regras antigas (contagem antes/depois).

## Fora de escopo (explicitamente)
- Nenhum `UPDATE` em `expenses` — pendentes seguem intactos.
- Regras Impostos/Folha/Reembolso/Fornecedor especial — inalteradas.
- Grupos de permissão, IdP, edge functions — inalterados.
