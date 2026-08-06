---
name: Cadeia de aprovação em rateio por projeto
description: Documentos rateados entre (CC, projeto) diferentes mesclam as cadeias das alçadas; todos aprovam, sem repetir quem fecha mais de uma ramificação.
type: feature
---
- Segmento de alçada = combinação **centro de custo + projeto** (não só CC).
- Quando as linhas caem em regras diferentes, a cadeia efetiva é a **mescla sequencial** das cadeias (`supabase/functions/_shared/rateio-chain.ts`), ordenada pela posição máxima de cada aprovador; quem fecha duas ramificações aprova uma única vez.
- O nível do solicitante continua sendo pulado (self-approval guard).
- Faixas de valor da Open Gaming (1.10.2.%/1.10.3.4) são **cumulativas**: DONALD 300k+ = Leonardo Rossini → Santiago Macedo → Marco Tulio; BET.BET 300k+ = Diogo Faria → Marco Tulio; OPEN GAMING 300k+ = Marco Tulio.
