# Registrar levantamento de custo em `docs/custo-projeto.md`

Criar um relatório markdown versionado no repositório com o custo total de desenvolvimento do ERP Flow na plataforma Lovable.

## Conteúdo do documento

- Cabeçalho: projeto, período apurado (07/02/2026 a 05/08/2026), premissa de R$ 0,35 por crédito, data do levantamento.
- Total consolidado: **5.940,25 créditos = R$ 2.079,09**.
- Tabela de breakdown por categoria:

| Categoria | Créditos | R$ | % |
|---|---:|---:|---:|
| Build mode (desenvolvimento) | 5.736,40 | 2.007,74 | 96,6% |
| Cloud (compute, egress, functions, storage) | 143,64 | 50,27 | 2,4% |
| AI Gateway (Gemini 2.5 Flash + GPT-5.5) | 17,20 | 6,02 | 0,3% |
| Plan mode | 43,00 | 15,05 | 0,7% |
| **Total** | **5.940,25** | **2.079,09** | 100% |

- Evolução por trimestre: 627,31 créditos (fev–mai/2026) vs. 5.312,94 (mai–ago/2026), média de ~R$ 347/mês.
- Custo recorrente de operação (Cloud + AI Gateway): R$ 56,29 acumulados, ~R$ 9/mês.
- Detalhamento dos itens de Cloud e AI Gateway (compute micro/pico, egress, functions, storage, realtime; tokens de entrada/saída por modelo).
- Seção "Fora do escopo": horas internas de desenvolvimento (excluídas a pedido) e serviços de terceiros (WhatsApp gateway, SMTP, BeCompliance/KYP, Mastertax, CNPJ, HanaAPI/infra SAP).
- Nota de reprodutibilidade: números extraídos do relatório de créditos do workspace filtrado por este projeto, em janelas de 90 dias.

## Detalhes técnicos

- Arquivo novo: `docs/custo-projeto.md`. Nenhum código de aplicação é alterado.
- Segue o padrão dos demais documentos em `docs/` (markdown, português, tabelas simples, cabeçalho com data e classificação interna).
