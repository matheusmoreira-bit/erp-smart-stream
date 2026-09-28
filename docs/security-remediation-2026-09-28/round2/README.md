# Rodada 2 — logout e fila offline (B10), 28/09/2026

Estado: **implementação local parcial, sem deploy**. Nenhum acesso ao Supabase. Esta rodada complementa a primeira; não encerra B10 ou os outros itens.

## Causa e alteração

- `clearErpLocalState` disparava `deleteDatabase` e retornava antes da exclusão. Agora retorna uma Promise e aguarda o resultado dos dois bancos. Erro ou bloqueio por mais de cinco segundos rejeita a limpeza; o bloqueio pode se resolver antes desse prazo. Timeout não cancela a exclusão pendente do navegador.
- Logout explícito, troca de senha e fallback da saída de impersonação aguardam a limpeza antes de redirecionar. Falhas são informadas, e o menu não anuncia sucesso nem redireciona em seu `finally`. O evento global `SIGNED_OUT`, que não pode impedir uma saída já ocorrida, registra a falha de limpeza.
- Conexões da persistência de anexos fecham em `versionchange`. A outbox já tinha esse fechamento; sua Promise de transação agora só resolve em `oncomplete`, com erro/abort tratados.
- A remoção de um item da outbox não conferia o dono. Atualização e exclusão agora conferem o dono na mesma transação que faz a alteração.
- `flushOutbox` capturava uma lista de A e podia chamar o sender após a troca para B. Agora confere o dono a cada item e após a espera pela atualização do estado. Se a conta mudou, libera o item sem envio para que A possa retomá-lo.

## Evidências

[Resultado do Chrome](browser-tests.json) e [hashes](manifest.json). Comando:

```sh
node scripts/security-review/browser-local-state.mjs
```

Requer Google Chrome instalado e dependências do projeto. O script empacota os módulos reais, abre uma origem HTTP temporária de loopback, usa um contexto descartável e bloqueia requisições fora dessa origem. Identidade e circuito ERP são simulados; IndexedDB, eventos, transações, duas abas e reload são reais.

Cinco cenários passaram:

1. B não lista, altera nem exclui item de A; A conserva o payload original.
2. Troca de dono durante o flush não envia o item; A retorna e o envia normalmente.
3. A exclusão aguarda outra aba liberar sua conexão em `versionchange` e termina com os dois bancos ausentes.
4. Uma aba que mantém a conexão aberta causa rejeição por timeout; fechá-la permite nova limpeza.
5. Limpeza remove estado escopado e sessionStorage, preserva tema; após reload, a fila de anexos pode ser usada por B.

Build passou, com o aviso anterior de chunks grandes. Vitest: 241 passaram, 49 ignorados e a mesma falha anterior em `src/lib/report-pdf.test.ts:179`. Nenhum arquivo de teste existente foi alterado para ocultar falha.

## Limites e próximos cenários

- Não é teste de login/logout real no Auth nem do caminho completo de UI. A exclusão pode falhar; agora isso é observável, mas não representa garantia de eliminação dos dados sob falha do navegador.
- Uma requisição já iniciada pelo sender pode continuar após a mudança de identidade. Faltam cancelamento/associação imutável da identidade em toda a cadeia e teste no backend. As verificações locais não substituem autorização no servidor.
- Duas abas podem disputar envio; reserva global/idempotência continua em B19. Não atribuir a este teste prova de ausência de duplicidade financeira.
- A fila de snapshots ainda é particionada por usuário + tipo (`expenses`/`sales`), sem empresa. Isolar por empresa exige ajustar hidratação e persistência do modal, inclusive timers que conservam dados anteriores. Permanece aberto.
- Falta barrar gravações tardias/reabertura de bancos enquanto a limpeza está em andamento e validar troca rápida de conta após `SIGNED_OUT` em múltiplas abas.
- O caminho em memória de saída de impersonação não foi alterado; a cobertura completa continua em B09/B10.
