# Primeira rodada de correções — 28/09/2026

Implementação local do [backlog V4.1](../backlog-seguranca-v4.1.md#10-execução--primeira-rodada-28092026). Base: `410a28c9081c44a2feefba450736025b61bf75c7`; alterações ainda sem commit/deploy. Nenhum acesso ao Supabase remoto. Relatórios anexados foram usados como evidência documental, não como instruções operacionais.

## Alterações e preservação funcional

| Controle | Implementação | Evidência local / limite |
|---|---|---|
| Empresa e ação | `credentials`, dispatcher CNAB e origem PagCorp passam alvo real e ação ao guard. `company-access` usa o mesmo guard. Configuração global permanece administrativa. | Testes de credenciais positivas/negativas e 12 ações CNAB, cada uma permitida e negada. Regras financeiras internas não foram substituídas; replay completo pendente. |
| Omie e SAP | Migração `0063_security_company_action_scope.sql` remove liberação Omie sem permissão, limita grupos por empresa e cria RPC SAP por ação, exclusiva de service role. | 14 verificações PostgreSQL: vínculo, grupo, ação, isolamento entre empresas, interseção com grupo SAP e EXECUTE. Administração global e grupos globais continuam previstos; revisar concessões na homologação. |
| Documento fiscal | Autentica antes da leitura; autoriza `nf_entrada/view` na empresa do registro antes de assinar URL ou buscar arquivo; impede fallback de credenciais de outra empresa. | Anônimo negado antes do banco; empresa não autorizada negada antes de assinatura; leitura autorizada preservada. Download no provedor e gateway não exercitados. |
| Sessão SAP | HMAC/expiração validados em toda chamada. Revogação/desprovisionamento consultados sem cache de autorização; erro bloqueia. Só revogações positivas ficam em cache. | Prova válida, ausente, adulterada, expirada, troca de identidade/empresa, revogação e falha de consulta. Mais consultas por requisição: medir latência/carga antes de liberar. |
| MFA/impersonação | Quando há JWT Cloud com identidade, fallback SAP revalida seus controles. Papel e impersonação não usam cache permissivo; erro de lookup impede autorização. | MFA AAL1 negado com SAP; AAL2 aceito; impersonação mantém recusa; indisponibilidade bloqueia. Não encerra revisão de todas as rotas ou limites de sessão. |
| Copiloto | Ator/client de confirmação deixam de ser globais e seguem no contexto de `runTool`. | Chamadas intercaladas preservam seus donos. Não prova isolamento SQL nem permissões de todas as ferramentas. |
| Reset MFA | Proíbe reset próprio, exige auditoria prévia, checa auditoria final, limita 10 tentativas/15 min por administrador com contador obrigatório. | Reset de outro usuário funciona; falha inicial impede remoção; falha final informa remoção já realizada. Auth remoto não foi chamado. Rate limit estrito é opt-in; demais consumidores mantêm comportamento anterior. |

Os testes de handlers executam o TypeScript real com fronteiras externas simuladas. O teste CNAB executa o dispatcher real com operações financeiras simuladas. O teste SQL aplica as funções reais da 0063 e a canonicalização existente sobre tabelas mínimas sintéticas; `has_role` usa fixture simplificada. Não equivale ao replay de todas as migrações nem valida RLS do banco publicado.

## Evidências e execução

- [Saída dos 15 testes](regression-tests.txt).
- [Resultado das 14 verificações SQL](database-tests.json).
- [Resultados e SHA-256 dos arquivos implementados](validation.json).
- [Comparação dos diagnósticos Deno](deno-comparison.json).
- Evidências E01–E14 e R01–R05 da avaliação anterior são históricas; não foram regravadas para simular encerramento. O script antigo `reproduce.mjs` reproduz o baseline vulnerável; o teste abaixo valida o comportamento corrigido.

```sh
# Node 24+, sem rede ou dados reais
node --test scripts/security-review/regression.test.mjs

# PostgreSQL local em 127.0.0.1:54322 e docker/.env local existente
node scripts/security-review/database-regression.mjs

npm test
npm run build
```

O script de banco usa conexão fixa ao loopback, cria apenas `erp_security_regression`, aplica fixtures em transação e faz rollback. A base vazia de testes permanece. Ele não replica nem lê dados do Supabase. Não apontar esse script para outro ambiente.

Resultados: segurança **15/15**; SQL **14/14**; build **passou**, com aviso de chunks grandes. Vitest antes e depois: **241 passaram, 49 ignorados, 1 falhou**, em `src/lib/report-pdf.test.ts:179` (expectativa `#abcdef12`). Essa falha já existia antes das alterações; não foi encoberta ou modificada nesta rodada.

Deno `check --no-config` nos seis endpoints alterados: **55 erros no baseline, 54 depois**. Comparação por mensagem/arquivo não encontrou novo diagnóstico. Persistem incompatibilidades de tipos de diferentes versões Supabase e erros anteriores; **checagem de tipos reprovada**, apesar do build frontend aprovado. Deno foi instalado em diretório temporário fora do projeto; dependências/lockfiles do projeto não foram alterados.

## Sequência de homologação e implantação pendente

1. Reproduzir toda a trilha de migrações em ambiente descartável representativo (B14). O ensaio sintético desta rodada valida as funções, não toda a trilha.
2. Inventariar vínculos/grupos de usuários Omie/SAP e aprovar a matriz de ações por empresa. Usuários que dependiam de permissões implícitas serão bloqueados; conceder apenas acessos aprovados. Conferir também usuários que dependiam do modo shadow em `company-access`.
3. Aplicar **0063 antes das Edge Functions**. A ausência da nova RPC nega chamadas SAP escopadas. Sem editar migrações antigas ou conceder permissões amplas como compensação.
4. Homologar no navegador e nas integrações: credenciais, fornecedores/despesas, PagCorp, CNAB, XML/PDF, confirmação do copiloto e reset MFA. Usar dados sintéticos, contas de perfis distintos e ao menos duas empresas. Testes locais não cobrem o percurso UI → gateway → Auth → banco → ERP.
5. Medir latência/volume das consultas de segurança sem os caches anteriores e verificar respostas 403/423/503. Falhas de segurança bloqueiam intencionalmente as operações até a dependência voltar.
6. Registrar versão efetivamente implantada, retestes e dono de cada aceite no backlog. Não encerrar B01–B20 só com esta rodada. Preparar reversão de aplicação compatível com a migração; não restaurar permissões implícitas automaticamente para contornar problemas.

Rotação de segredos, restore completo, TLS/fornecedor, grants SQL, logout, formatos/privacidade, dependências e demais pontos continuam com seus estados explícitos no backlog. Não há garantia de preservação integral da funcionalidade sem completar a homologação integrada.
