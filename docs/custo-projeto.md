# Custo de Desenvolvimento — ERP Flow

**Projeto:** ERP Flow (Cactus Corporation) · **Plataforma:** Lovable
**Período apurado:** 07/02/2026 a 05/08/2026 (~6 meses) · **Data do levantamento:** 05/08/2026
**Premissa de conversão:** US$ 0,35 por crédito · **Câmbio:** USD/BRL 5,0958 (05/08/2026)
**Equivalente:** R$ 1,7835 por crédito · **Classificação:** interno

> Não há consumo registrado para este projeto antes de 07/02/2026.

## Total consolidado

**5.940,25 créditos = US$ 2.079,09 = R$ 10.594,53**

| Categoria | Créditos | US$ | R$ | % |
|---|---:|---:|---:|---:|
| Build mode (desenvolvimento) | 5.736,40 | 2.007,74 | 10.230,96 | 96,6% |
| Cloud (compute, egress, functions, storage) | 143,64 | 50,27 | 256,18 | 2,4% |
| AI Gateway (Gemini 2.5 Flash + GPT-5.5) | 17,20 | 6,02 | 30,68 | 0,3% |
| Plan mode | 43,00 | 15,05 | 76,69 | 0,7% |
| **Total** | **5.940,25** | **2.079,09** | **10.594,53** | **100%** |

## Evolução no tempo

| Janela | Créditos | US$ | R$ |
|---|---:|---:|---:|
| 07/02/2026 – 07/05/2026 | 627,31 | 219,56 | 1.118,82 |
| 08/05/2026 – 05/08/2026 | 5.312,94 | 1.859,53 | 9.475,71 |

Média de ~R$ 1.766/mês (US$ 347/mês) no período completo. O ritmo acelerou
fortemente no segundo trimestre, acompanhando as fases de segurança,
integrações SAP/HANA, PagCorp, matrizes de aprovação e notificações.

## Custo recorrente de operação

Cloud + AI Gateway somam **US$ 56,29 (R$ 286,86) acumulados**, ou aproximadamente
**R$ 48/mês** — é o custo que permanece mesmo sem novos desenvolvimentos
(banco, edge functions, egress e chamadas de IA em produção).

## Detalhamento — Cloud

| Item | Créditos |
|---|---:|
| Cloud compute micro | 64,190 |
| Cloud compute pico | 61,984 |
| Cloud egress | 10,355 |
| Cloud usage | 5,190 |
| Cloud functions | 1,894 |
| Cloud cached egress | 0,032 |
| Cloud realtime | 0,003 |
| Cloud file storage | 0,001 |
| **Subtotal** | **143,64** |

## Detalhamento — AI Gateway

| Item | Créditos |
|---|---:|
| google/gemini-2.5-flash — output tokens | 11,817 |
| google/gemini-2.5-flash — input tokens | 5,050 |
| openai/gpt-5.5 — input tokens | 0,214 |
| openai/gpt-5.5 — output tokens | 0,116 |
| **Subtotal** | **17,20** |

## Fora do escopo deste levantamento

- **Horas internas de desenvolvimento** — excluídas por decisão do solicitante.
- **Serviços de terceiros** — gateway WhatsApp, SMTP transacional,
  BeCompliance/KYP, Mastertax, consulta de CNPJ, HanaAPI e infraestrutura SAP B1.
- **Domínio customizado e assinatura de plano** — cobrados fora do consumo de créditos.

## Reprodutibilidade

Números extraídos do relatório de créditos do workspace, filtrado pelo ID deste
projeto e agrupado por item faturável, em janelas sucessivas de até 90 dias
(limite da consulta). Somatório das janelas: 627,31 + 5.312,94 = 5.940,25 créditos.
Conversão: US$ 0,35/crédito, convertidos a R$ 5,0958/US$ (cotação de 05/08/2026).
Valores em reais variam com o câmbio — refazer a conversão em novas apurações.
