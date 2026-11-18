# Proteção de admissão por integrações

## Escopo e resultado

As três APIs consumidoras de `validateApiKey` foram protegidas e implantadas: external-approvals-api, expense-tracking-api e pagcorp-status-api. Nenhuma chave, perfil, papel, credencial, cron ou documento foi alterado. Leitura administrativa após implantação: **enabled=false, ready=false, manager=true, versão 2**.

Quando a restrição estiver ativa:
- Uma chave técnica sozinha não libera leitura ou decisão: exige chave em x-api-key e uma sessão humana verificada em Authorization.
- A sessão passa pelo verificador existente, incluindo domínio, revogação, MFA administrativo e admissão por UUID; não aceita identidade declarada em headers nem dispensa por scheduler/service role informado pelo cliente.
- Aprovar/rejeitar/listar SAP por integração exige identidade SAP do próprio caller, resolvida por aliases canônicos, e admissão do ator; listagem geral sem pessoa e impersonação são negadas.
- Recusas ocorrem antes de telemetria de uso de chave, consulta de dados de negócio, rate limit do endpoint ou chamada SAP.
- Não existe cache do estado global: reabertura/restauração são vistas na próxima requisição.

Com o bloqueio desligado, contratos antigos de automação key-only permanecem funcionais. Um bearer pessoal separado, quando apresentado, é verificado e não pode falhar silenciosamente para a chave.

**Impacto explícito para futura ativação:** automações destas três APIs que usam somente chave serão recusadas enquanto o modo restrito estiver ativo. Não foi criada exceção técnica sem identidade, pois reabriria o contorno solicitado. Rotinas agendadas de outros módulos não foram modificadas. A compatibilidade destas integrações sob restrição precisa de sessão legítima ou desenho próprio de autenticação de serviço revisado antes da ativação global.

## Verificação

- `bunx vitest run src/lib/integration-admission.test.ts src/lib/erp-access.test.ts src/lib/erp-resource-access.test.ts src/lib/automation-auth.test.ts`: **61 testes passaram**.
- 14 testes novos: chave válida + usuário bloqueado, chave sem pessoa, headers de dispensa falsos, bearer inválido sem fallback, consulta do controle com erro, gate sem cache/reabertura, três pessoas autorizadas em cenários sintéticos, ator SAP alheio/listagem global/input inválido e execução dos três entrypoints reais com dependências isoladas sem efeitos de negócio.
- `deno check --no-config` dos dois helpers: aprovado.
- Preview: build OK; git diff --check aprovado.
- Três APIs implantadas recusaram chave/token inválidos com **401**. Isso verifica implantação/recusa básica, não uma chave válida com gate real ativado.
- Estado restrito foi testado apenas com dependências sintéticas; produção/preview compartilham banco e a restrição real não foi ativada para teste. Não foi obtida chave privada de produção para executar dados reais.

## Arquivos

supabase/functions/_shared/integration-admission.ts; supabase/functions/_shared/api-keys.ts; supabase/functions/external-approvals-api/index.ts; supabase/functions/expense-tracking-api/index.ts; supabase/functions/pagcorp-status-api/index.ts; src/lib/integration-admission.test.ts; AGENTS.md; roadmap.md; este relatório.

## Segurança e limites

- Fonte→sink: chave de serviço não autoriza admissão; sessão verificada e ator resolvido antecedem consultas/decisões. Sem SQL dinâmico, novos segredos ou permissões.
- RLS/grants: não alterados; nenhuma migration necessária.
- Segredos: somente variáveis existentes; nenhum valor privado escrito.
- SSO/MFA e políticas de senha/antibrute-force hospedadas: preservadas; configurações globais não revalidadas.
- HTTPS/HSTS: cabeçalhos observados nas chamadas publicadas; sem nova URL com token.
- CORS: contrato de headers preservado e Authorization permitido na API de status; revisão global de CORS/CSP/criptografia/CodeQL não realizada.
- Links antigos de anexos e tarefas reais nas sessões de Mauricio/Juliana/Artur permanecem pendentes fora deste escopo.

**GO para esta proteção implantada e testada isoladamente; NO-GO para ativar o bloqueio global ou afirmar validação real completa com chaves válidas em modo restrito.** Revisão guiada por revisao-seguranca-lovable.