## Diagnóstico (sem alterações no código)

Você pediu apenas o "porquê". Nenhuma alteração será feita.

### Por que o José Victor recebe aprovações de CC 1.8.1.4 + projeto Donald + valor < 100k na OpenGaming

1. Existem regras específicas de prioridade **200** para `CC 1.8.1.4 + project = "DONALD"` (faixas 0–10k, 10k–300k, 300k+), com aprovadores **Leonardo Rossini** (nível 1) e **Lucas Pereira** (nível 2).
2. Nos documentos que estão sendo roteados, o campo Project vindo do SAP é **"DONALD BET"** (verificado em `expense_items.project` de várias despesas recentes, ex. R$ 96.564,57, R$ 75.000, etc.).
3. As regras de prioridade 200 usam operador **equal** com valor `"DONALD"` — não casam com `"DONALD BET"`.
4. Como nenhuma regra de prioridade 200 casa, o engine (`findMatchingRule` em `src/lib/approvalSegments.ts`) cai para a genérica **"1.8 Novos Negocios | 1.8.% | 0-300k"** (prioridade 100, sem filtro de projeto), cujo nível 1 é **Jose Victor** (`jose.victor@anagaming.com.br`).

### Resumo

Descasamento entre o código de projeto no SAP (`"DONALD BET"`) e o cadastrado nas regras (`"DONALD"`). Quando quiser corrigir, as opções são: ajustar as regras para `"DONALD BET"`, trocar o operador para `like "DONALD%"`, ou padronizar o código no SAP.
