# Quick-book de Aprovações — HTML export para PDF

Documento único, autocontido, com prints reais do sistema, pronto para ser aberto no navegador e exportado como PDF (Ctrl/Cmd+P → Salvar como PDF).

## Entregável

Arquivo `docs/quickbook-aprovacoes.html` no repositório, com:

- CSS embutido (sem dependências externas) e `@page` para paginação/margem em PDF.
- Prints como imagens locais em `docs/quickbook-aprovacoes/img/` referenciados por caminho relativo.
- Capa, sumário, cabeçalho/rodapé de página, tipografia serifada elegante para leitura longa (Source Serif) + sans para UI callouts (Inter) via `@fontsource`.
- Callouts visuais: "Dica", "Atenção", "Somente admin".

## Seções previstas

1. **Capa & Sumário**
   - Título, versão, data (08/07/2026), público-alvo.

2. **Visão geral do fluxo**
   - Diagrama ASCII: Solicitante → Regra de aprovação → Nível 1 → Nível N → Aprovado/Reprovado.
   - Onde vive cada coisa no app: `/aprovacoes` (hub), `/aprovacoes?tab=history`, `/aprovacoes/regras`, `/compras` (Despesas ERP), `/despesas` (Despesas internas — confirmar rota).
   - Papéis: solicitante, aprovador designado, aprovador substituto, aprovador delegado, super-usuário/admin.

3. **Aprovações — tela `/aprovacoes` (Pendentes)**
   - Print da lista.
   - Filtros, "Ver todas as aprovações" (default ON para admin), busca, ordenação.
   - Card do documento e ações rápidas.

4. **Modal de decisão do documento**
   - Print do modal aberto (cabeçalho, itens, comentário, rodapé com Aprovar/Reprovar/Delegar).
   - Explicação campo a campo, atalhos (Esc/Ctrl+Enter).
   - Aviso de super-usuário atuando em nome de outro aprovador.

5. **Fluxos de aprovação padrão**
   - Quando um documento cai no fluxo padrão (nenhuma regra personalizada casa).
   - Ordem de aprovadores, escalonamento por valor.

6. **Fluxos personalizados — `/aprovacoes/regras`**
   - Print da lista de regras e do modal de criação.
   - Critérios (projeto, categoria, valor, tipo de documento), níveis de aprovação, prioridade, ativação, simulador de regra.
   - Como uma regra é escolhida (prioridade + match de critérios).

7. **Aprovadores substitutos** (SubstituteApproversTab)
   - Print da tela de configuração.
   - Diferença conceitual: substituto = cobre o titular durante ausência; herda automaticamente as pendências no período.
   - Como configurar período/vigência.

8. **Aprovadores delegados** (delegação por documento)
   - Print do botão "Delegar" no modal + modal de delegação + badge "Revogar delegação".
   - Diferença vs. substituto: delegação é por documento (ou pontual), com validade e motivo.
   - Como ver quem delegou/para quem no histórico (evento `delegate_approval`).
   - Regra memorizada: aprovações delegadas continuam aparecendo mesmo sem "Ver todas".

9. **Despesas internas**
   - Print da tela e do modal de criação.
   - Ciclo de vida: rascunho → em aprovação → aprovado/reprovado → pago.
   - Como o aprovador vê no `/aprovacoes` e no histórico interno (`InternalApprovalHistory`).

10. **Despesas do ERP (compras)**
    - Print de `/compras` e do detalhe.
    - Origem OMIE, integração e status de retorno; regra memorizada: empresas OMIE mantêm módulos abertos para todos.
    - Reintegração manual (somente super-usuário).

11. **Histórico de aprovações**
    - Print de `/aprovacoes?tab=history` e do `ExpenseEventHistory` / `InternalApprovalHistory`.
    - Eventos exibidos: submissão, aprovação, reprovação, delegação (com validade e status), substituição, comentários.
    - Regra memorizada: usuário vê só o que criou/aprova; admin tem toggle "Ver todos" default ON.

12. **Funcionalidades gerais**
    - Notificações e badges de contagem no menu.
    - Comentários em decisões e uso obrigatório em reprovações (se aplicável — confirmar).
    - Atalhos de teclado.
    - Ações em massa (se existirem).
    - Papel do super-usuário/admin: `Ver todas`, delegar em nome de, reintegrar SAP, etc.

13. **Perguntas frequentes / troubleshooting**
    - "Não estou vendo um documento" → checar filtros e "Ver todas".
    - "Deleguei mas o outro aprovador não vê" → validade da delegação.
    - "Aprovador titular saiu de férias" → usar substituto, não delegação.

## Como os prints serão obtidos

Script Playwright em `/tmp/browser/quickbook/capture.py`:

- Restaura sessão gerenciada (`LOVABLE_BROWSER_AUTH_STATUS=injected`) contra `http://localhost:8080`.
- Navega em sequência pelas rotas: `/aprovacoes`, modal aberto (abre o primeiro card), modal de delegação, `/aprovacoes/regras`, modal "Nova regra", `/aprovacoes?tab=history`, aba de substitutos, `/compras`, tela de despesas internas.
- Cada passo salva PNG em `docs/quickbook-aprovacoes/img/NN-nome.png` com viewport 1280×1800.
- Se algum estado não puder ser reproduzido no ambiente (ex.: sem dados), o print é substituído por um placeholder textual descritivo e um TODO fica marcado no HTML.

Se `LOVABLE_BROWSER_AUTH_STATUS` for `signed_out`/`external_unmanaged`, o script para e o documento fica com placeholders — aviso o usuário e ele decide.

## Detalhes técnicos

- Arquivos criados:
  - `docs/quickbook-aprovacoes.html`
  - `docs/quickbook-aprovacoes/img/*.png`
  - `/tmp/browser/quickbook/capture.py` (não versionado; apenas ferramenta de build do PDF).
- Sem alteração em código de aplicação. Sem novas dependências npm. Fontes carregadas por CDN local não são usadas — o HTML fica autocontido usando `font-family` padrão do SO (Georgia + system-ui) para não depender de rede na exportação a PDF.
- CSS `@media print` com quebras de página por seção, cabeçalho fixo com título/versão e rodapé com número de página.
- Não são feitas alterações em backend, RLS, secrets ou config.

## Fora de escopo

- Não gero um PDF final aqui (o usuário exporta via navegador).
- Não crio página no app apontando para o documento (o formato escolhido foi HTML export para PDF).
- Não altero nenhum comportamento do fluxo de aprovação — apenas documento.
