---
name: lovable-debug-discipline
description: Disciplina de debug e edição para este projeto ERP/SAP. Carregar em pedidos de correção de bug, "ainda não funciona", loops de fix repetido, refactors em hooks ou edge functions, e qualquer tarefa cujo sintoma aparece na UI mas a causa pode estar no fluxo de dados (página → hook → edge function → modal). Inspirada nos princípios da ponytail (root-cause, reuse, trace).
---

# Lovable Debug Discipline

Três checklists obrigatórios antes de editar código em resposta a bug ou pedido de correção. Pular qualquer um aumenta a chance de loop de fix em sintoma.

## 1. Root-cause first

Antes de editar uma função, hook ou componente:

1. `rg -n "<nome_do_simbolo>" src supabase` — listar todos os callers.
2. Se houver **2+ callers**, a correção vai no ponto compartilhado, não em cada chamador.
3. Se o sintoma só aparece em 1 caller mas o código vive em local compartilhado, ainda assim ler os outros callers antes de mudar a assinatura.
4. Nunca "fixar" trocando placeholder, copy, ou adicionando `if` defensivo no consumidor quando a função compartilhada está errada.

## 2. Reuse first

Antes de criar helper, hook, componente ou util novo, checar se já existe similar:

- Hooks de dado/SAP: `src/hooks/` (ex.: `useSapCachedList`, `usePagCorpCardMapping`, `useCompanies`).
- Combobox/busca: `src/components/CachedSearchCombobox.tsx`, `src/components/SapSearchCombobox.tsx`.
- Fetch autenticado: `src/lib/auth-fetch.ts` (`sapFunctionFetch`, `publicFunctionFetch`) — nunca chamar Supabase Functions com `fetch` cru.
- UI shadcn: `src/components/ui/` (Alert, Dialog, Form, Select). Reaproveitar variantes antes de criar nova.
- Edge functions: `supabase/functions/` — checar se já há função que faz a operação.

Se for reescrever algo similar, abrir o existente, comparar, e ou estender ou justificar por que precisa de outro.

## 3. Trace-before-fix

Para bug do tipo "valor não chega em X" (ex.: campo não preenche, filtro não aplica, status não atualiza):

Escrever mentalmente — ou no chat antes de editar — 3 linhas:

```
Origem:        <onde o valor nasce>      ex.: PagCorp.tsx prefill.cardId
Transformação: <quem mexe no caminho>    ex.: usePagCorpCardMapping.describe() → normalizeKey/digitKey
Sink:          <onde aparece/deveria>    ex.: CreateExpenseModal useEffect aplicando defaults
```

Só editar depois de entender as 3 etapas. Se faltar visibilidade em uma delas, ler o arquivo antes de mudar.

## Anti-padrões observados neste projeto

- Trocar `placeholder` ou texto de banner como "correção" de mapeamento que não preenche.
- Duplicar normalização de chave (lowercase/trim/digits) em vez de centralizar.
- Adicionar `useEffect` que sobrescreve estado sem checar quem mais escreve no mesmo campo (race entre prefill, AI processing, mapping defaults).
- Esquecer `company_db` em queries de integração (ver memory `integration-base-segregation`).
- Chamar Supabase com `fetch` direto em vez de `sapFunctionFetch`/`publicFunctionFetch`.

## Caso de referência: loop do mapeamento PagCorp

Sintoma: Centro de Custo / Projeto / Item não preenchiam no modal "Integrar Prestação de Conta" mesmo com mapeamento salvo.

Iterações que **não** seguiram a disciplina:
1. Trocar placeholder e copy do banner — sintoma em UI, sem tocar no fluxo de dado.
2. Adicionar fallback de empresa — sem traçar origem do `cardId`.
3. Banner de status — útil, mas ainda não corrige o resolver.

Iteração que resolveu: trace completo `PagCorp.tsx prefill → usePagCorpCardMapping (matching por digitKey/normalizeKey, isLoaded flag) → CreateExpenseModal (espera `cardMappingLoaded` antes de pre-fill, reaplica defaults após AI processing)`.

Lição: o trace deveria ter vindo na iteração 1.
