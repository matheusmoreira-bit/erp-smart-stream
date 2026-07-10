## Diagnóstico

O combobox de fornecedor no modal "Nova Compra" mostra apenas o que vem do endpoint `BusinessPartners` do SAP daquela empresa, com filtro `CardType eq 'cSupplier' and Frozen eq 'tNO'`, cacheado em `sap_cache` por 5 minutos.

Isso deixa quatro tipos de fornecedor invisíveis, mesmo estando "cadastrados no ERP":

1. **Cadastrados mas com falha de sync no SAP** (`suppliers.sap_sync_status` em `error`, `pending` ou `skipped`). Existem em `public.suppliers` mas nunca chegaram ao BP do SAP → não aparecem.
2. **Cadastrados em outra empresa** (company_db diferente da sessão atual). Usuário troca de empresa no menu, mas não é avisado.
3. **Congelados no SAP** (`Frozen='tYES'`) por engano.
4. **Digitação divergente**: acento, espaço extra, ordem de palavras. O filtro atual é `String.includes` cru, sem normalização.

Além disso, o "Nenhum resultado" é um beco sem saída — não oferece nem criar na hora nem diagnosticar.

## O que mudar

### 1. Unir SAP + tabela local no combobox (resolve #1)
No `CreateExpenseModal`, além da lista vinda do `useSapCachedList`, buscar `public.suppliers` da empresa atual e fazer merge por `card_code`/CNPJ. Fornecedores locais sem contraparte no SAP aparecem com badge âmbar "Não sincronizado — clique para reenviar", e ao selecionar dispara o retry de sync antes de continuar. Isso mata a classe #1 sem esperar SAP.

### 2. Empty state acionável (resolve #4 e reduz #1)
Quando o filtro retornar 0, o dropdown passa a mostrar três ações contextuais:
- **"Cadastrar novo fornecedor «{texto}»"** — abre o `SupplierFormModal` já pré-preenchido com o texto digitado (nome ou CNPJ, se só dígitos).
- **"Encontrei em outra empresa"** — se o texto casar em `public.suppliers` de outro `company_db`, listar as ocorrências ("Também existe em Anagaming SA como CardCode C000123"). Só informa, não seleciona.
- **"Atualizar lista do SAP"** — força `reloadSuppliers()` e mostra o novo total.

### 3. Alerta de contexto de empresa (resolve #2)
Abaixo do campo Fornecedor, uma linha discreta: "Buscando em **Open Gaming SA** · 312 fornecedores ativos". Quando o total é 0 ou anormalmente baixo, o texto vira aviso âmbar "Cache pode estar vazio — atualizar". Isso ancora o usuário no `company_db` correto sem exigir que ele saiba dessa distinção.

### 4. Incluir Frozen com marcação (resolve #3)
Trocar o filtro SAP de `Frozen eq 'tNO'` para trazer todos e marcar frozen com badge "Inativo — reativar?". Ao selecionar um inativo, botão "Reativar no SAP" (usa a mesma rota que a tela de Fornecedores já tem) antes de prosseguir com o pedido.

### 5. Filtro tolerante (resolve #4)
No `CachedSearchCombobox`, normalizar antes de comparar:
- lowercase + `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` (remove acento)
- colapsar espaços; matching por todas as palavras (AND), não substring único
- ranking: prefixo do nome > CNPJ > substring > match parcial de palavras

Isso resolve casos como digitar "acucar uniao" e encontrar "AÇÚCAR UNIÃO LTDA".

### 6. Invalidação em tempo real entre usuários (opcional, resolve latência residual)
Assinar `postgres_changes` em `public.suppliers` filtrado por `company_db` da sessão. Ao chegar INSERT/UPDATE, chamar `invalidateSapCache(["suppliers_active_v2", …])`. Hoje só invalida quem cadastrou; com isso, outros usuários com o modal já aberto veem o novo fornecedor sem reabrir.

## Detalhes técnicos

- Arquivos afetados: `src/components/CreateExpenseModal.tsx`, `src/components/CachedSearchCombobox.tsx`, `src/hooks/useSapCachedList.ts` (nova prop `showFrozen`), `src/hooks/useSuppliers.ts` (expor busca cross-company leve), possivelmente um novo `src/components/SupplierPickerFooter.tsx` para o empty state acionável.
- Sem migração — usa tabelas existentes (`suppliers`, `sap_cache`).
- O empty state acionável deve reusar o `SupplierFormModal` já existente para não bifurcar o fluxo de cadastro.
- A busca cross-company (#2) fica em `public.suppliers` (Supabase), não vasculha SAP de outras bases — barato e respeita RLS.
- Realtime (#6) só liga se `useSap().session?.companyDB` existir; fecha o canal ao desmontar.

## Pergunta antes de começar

Quer que eu implemente **todos os seis** itens de uma vez, ou prefere fatiar? Se fatiar, a maior dor pelo que descrevem soa ser o **#1 (fornecedor com sync SAP falho)** + **#2 (empresa errada)** + **#5 (tolerância de digitação)**. Faço só esses três primeiro (baixo risco, sem migração, resolve ~80% dos casos) e depois volto para os demais — ou vamos em tudo?