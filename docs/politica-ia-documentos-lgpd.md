# Política de uso de IA com documentos (LGPD) — ERP Flow

**Status:** RASCUNHO — aguardando aprovação (Jurídico/DPO e Controladoria).
**Versão:** 1.0 · 24/09/2026 · Item de segurança F14.

## 1. Finalidade
A IA lê notas fiscais, recibos, boletos e comprovantes **somente** para pré-preencher lançamentos de despesa e conferir cartões corporativos. Nenhum outro uso (treino, perfilamento, marketing) é permitido.

## 2. Base legal
Execução de contrato e cumprimento de obrigação legal/fiscal (LGPD art. 7º, II e V). Os documentos já são exigidos pelo processo de compras e contas a pagar.

## 3. O que é enviado (minimização)
| Tipo | Envio |
|---|---|
| Foto/PDF do documento | Enviado, sem metadados (GPS, aparelho, comentários são removidos). |
| Arquivos de texto | Cartões de crédito, e-mails e telefones são mascarados antes do envio. |
| Dados de pagamento (linha digitável, PIX do beneficiário) | Lidos só na leitura completa de despesa, porque são necessários para pagar. A leitura rápida pelo celular não os transcreve. |
| Dados de terceiros (pessoas físicas que não são o emitente) | Instrução explícita para não transcrever. |

## 4. Para onde vai
- Apenas o **Lovable AI** (gateway), em rotas **sem retenção de dados no provedor** (zero data retention). O envio direto a outros provedores está desligado.
- A chave de IA fica somente no servidor.

## 5. Quem pode usar
- Somente pessoas logadas com conta corporativa; o token é validado no servidor.
- Limite de uso por pessoa (leitura rápida: 30 a cada 5 min; leitura completa: 60 a cada 5 min).

## 6. Retenção
| Dado | Onde | Prazo |
|---|---|---|
| Documento original | Anexo da despesa (armazenamento do sistema) | Prazo fiscal: 5 anos após o exercício. |
| Resultado da leitura (campos extraídos) | Cache de análises | 180 dias, depois apagado. |
| Documento no provedor de IA | — | Não retido. |
| Registros técnicos (logs) | Sem conteúdo do documento | 90 dias. |

## 7. Direitos do titular
Pedidos de acesso/eliminação vão ao DPO; a eliminação respeita o prazo fiscal obrigatório.

## 8. Revisão
Anual, ou quando mudar o provedor de IA ou a finalidade.

## Aprovação
| Nome | Área | Data | Assinatura |
|---|---|---|---|
| | Jurídico / DPO | | |
| | Controladoria | | |
