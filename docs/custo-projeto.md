# Custo de Desenvolvimento — ERP Flow

**Projeto:** ERP Flow (Cactus Corporation) · **Plataforma:** Lovable
**Período apurado:** 07/02/2026 a 05/08/2026 (~6 meses) · **Data do levantamento:** 05/08/2026
**Premissa de conversão:** R$ 0,35 por crédito · **Classificação:** interno

> Não há consumo registrado para este projeto antes de 07/02/2026.

## Total consolidado

**5.940,25 créditos = R$ 2.079,09**

| Categoria | Créditos | R$ | % |
|---|---:|---:|---:|
| Build mode (desenvolvimento) | 5.736,40 | 2.007,74 | 96,6% |
| Cloud (compute, egress, functions, storage) | 143,64 | 50,27 | 2,4% |
| AI Gateway (Gemini 2.5 Flash + GPT-5.5) | 17,20 | 6,02 | 0,3% |
| Plan mode | 43,00 | 15,05 | 0,7% |
| **Total** | **5.940,25** | **2.079,09** | **100%** |

## Evolução no tempo

| Janela | Créditos | R$ |
|---|---:|---:|
| 07/02/2026 – 07/05/2026 | 627,31 | 219,56 |
| 08/05/2026 – 05/08/2026 | 5.312,94 | 1.859,53 |

Média de ~R$ 347/mês no período completo. O ritmo acelerou fortemente no
segundo trimestre, acompanhando as fases de segurança, integrações SAP/HANA,
PagCorp, matrizes de aprovação e notificações.

## Custo recorrente de operação

Cloud + AI Gateway somam **R$ 56,29 acumulados**, ou aproximadamente
**R$ 9/mês** — é o custo que permanece mesmo sem novos desenvolvimentos
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
Conversão para reais aplicando R$ 0,35/crédito.
