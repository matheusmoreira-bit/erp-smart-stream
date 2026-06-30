# Aplicar princípios da ponytail neste projeto

Objetivo: materializar 3 princípios (root-cause first, reuse first, trace-before-fix) como (a) regras sempre em contexto no `mem://index.md` e (b) uma skill operacional com checklist, exemplos e gatilhos de retrieval.

## 1. Atualizar `mem://index.md` (Core sempre em contexto)

Adicionar 3 linhas curtas na seção **Core**:

- Root-cause first: antes de editar uma função, `rg` os callers e corrigir no ponto compartilhado, não no sintoma local.
- Reuse first: antes de criar helper/componente, procurar similar existente (`useSapCachedList`, `CachedSearchCombobox`, `sapFunctionFetch`, `Alert`, `usePagCorpCardMapping` etc.).
- Trace-before-fix: em bug de "valor não chega em X", mapear origem→sink (página → hook → edge function → modal) antes de editar.

Adicionar uma linha em **Memories** apontando para a skill.

## 2. Criar skill `.agents/skills/lovable-debug-discipline/`

Arquivos:

- `SKILL.md` com frontmatter:
  - `name: lovable-debug-discipline`
  - `description`: dispara em pedidos de correção de bug, "ainda não funciona", loops de fix, refactors em hooks/edge functions e qualquer tarefa onde o sintoma é em UI mas a causa pode estar no fluxo de dados.
- Conteúdo do SKILL.md (curto, operacional):
  1. **Checklist root-cause** — `rg -n "<symbol>"` antes de editar; se 2+ callers, corrigir no compartilhado.
  2. **Checklist reuse** — listar primitivas do projeto a checar antes de criar nova: hooks `src/hooks/`, componentes UI `src/components/ui/`, helpers `src/lib/`, edge functions `supabase/functions/`.
  3. **Trace-before-fix** — para bugs de dados, escrever em 3 linhas: origem do valor, transformações intermediárias, sink onde aparece (ou deveria aparecer); só então editar.
  4. **Anti-padrões** — não trocar placeholder/copy como "fix", não duplicar lógica de matching/normalização, não adicionar `useEffect` que sobrescreve estado sem checar quem mais escreve no mesmo campo.
  5. **Mini caso de referência**: o loop recente do mapeamento PagCorp (Centro de Custo / Projeto / Item) como exemplo do que evitar.

- Sem `scripts/` nem `references/` nesta primeira versão — manter <100 linhas, focado.

## 3. Ativar a skill

Rodar `skills--apply_draft` com `.agents/skills/lovable-debug-discipline`.

## Fora de escopo

- Não copiar arquivos da ponytail (licenciamento + não são lidos pelo Lovable).
- Não criar benchmarks/self-tests (infra de avaliação de agente, não do ERP).
- Nenhuma mudança em código de aplicação, banco, RLS ou edge functions.

## Detalhes técnicos

- Arquivos tocados: `mem://index.md` (edit), `.agents/skills/lovable-debug-discipline/SKILL.md` (novo).
- Após `apply_draft`, a skill passa a viver em `.workspace/skills/lovable-debug-discipline/` e é surfaceada por retrieval quando a descrição bater com a tarefa.
