# Corrigir cartões que reaparecem após aprovação

## Objetivo
Garantir que, após Robson aprovar um documento, o cartão não volte para a fila dele enquanto aguarda outro aprovador paralelo.

## Implementação
1. **Confirmação no SAP**
   - Identificar a linha pendente pertencente ao usuário antes de enviar a decisão.
   - Após aprovar ou rejeitar, reler a solicitação no SAP e só mostrar sucesso quando a decisão estiver realmente gravada.
   - Se o SAP não confirmar, manter o cartão e mostrar uma mensagem clara, sem falso sucesso.

2. **Fila de aprovações internas**
   - No nível em que todos precisam aprovar, descontar as decisões já registradas no ciclo atual.
   - Excluir da fila pessoal quem já aprovou, mantendo o documento apenas para os aprovadores ainda pendentes.
   - Preservar substituições, reenvios após edição e aprovações segmentadas.

3. **Proteção contra atraso de atualização**
   - Impedir que a atualização automática recoloque imediatamente um cartão cuja decisão acabou de ser confirmada.
   - Retirar essa proteção assim que a fonte oficial refletir o novo estado.

## Validação
- Testar aprovação paralela: Robson aprova, o cartão some apenas para ele e permanece para o segundo aprovador.
- Confirmar que uma falha real do SAP não remove o cartão nem informa sucesso.
- Validar aprovação simples, rejeição, substituto e documento reenviado após edição.
- Conferir compilação, registros de erro e tela em funcionamento.
