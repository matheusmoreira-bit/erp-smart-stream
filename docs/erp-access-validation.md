# Controle reversível de acesso — estado em 17/11/2026

## Estado efetivo
**NO-GO para ativação. Restrição desligada (`enabled=false`, `coverage_verified=false`, versão 2).** Nenhum usuário foi bloqueado.

Cinco pessoas autorizadas: Mauricio Farias, Juliana Gavineli, Artur Angelo, Hiller Brandão e Douglas Vinicius. As duas contas administrativas existentes de Hiller estão vinculadas explicitamente; seis UUIDs representam as cinco pessoas. Nenhum papel foi concedido ou removido.

## Implementado
- Configuração versionada, gestão transacional com identidade verificada/admin/MFA, lista individual e restauração geral; administradores de recuperação não podem ser removidos.
- Restrição adicional nas 212 tabelas públicas, mantendo as políticas anteriores. Ela permanece inerte enquanto desligada.
- Guardas de identidade humana em Cloud/SAP e principais funções que tinham verificadores próprios; verificação de ator delegado em aprovação por link, antes de resumo/consumo.
- Omie exige identidade e empresa em todas as ações antes de ler credenciais. Corrigida prova de administrador inadequada em alteração de linha integrada; agora usa verificação administrativa com MFA existente.
- Tela `/backoffice/controle-acesso`, acessível pelo menu administrativo; bloqueio de montagem da experiência antes de carregar provedores de ERP, consulta periódica e estados de erro/acesso negado.
- Ativação recusada no servidor até revisão completa da cobertura. Cliente não pode marcar a cobertura como validada.
- 46 funções privilegiadas recebem admissão antes do corpo original (0079); contratos e filtros mantidos. Verificadores de identidade/MFA e recuperação permanecem separados.

## Verificado
- Retomada 18/11 12:25 UTC: PostgreSQL temporário local recriado do zero; fixture sintética e migrations 0077/0078/0079 reaplicadas exatamente. Bloqueio das cinco pessoas/outro admin, leituras RLS/Storage/RPC, MFA, concorrência, reabertura individual e restauração por Douglas passaram novamente; servidor temporário parado após o teste. Sete testes de guarda também passaram novamente.
- Catálogo atual de políticas: todas as tabelas com políticas em public/storage possuem quatro políticas de admissão, exceto erp_access_control (política única de leitura para gestores, intencional). Essa consulta não prova ausência de tabelas sem políticas nem cobertura de funções que usam credenciais internas.
- Revisão independente das entradas alternativas iniciada (sub_zr5058r2), sem alterações de código; aguardando resultado. API keys técnicas não identificam necessariamente uma pessoa e precisam classificação explícita, sem cancelar integrações silenciosamente.
- Retomada 18/11 12:21 UTC: ferramenta administrativa confirmou MFA por status HTTP 200, manager=true, cinco pessoas/six contas e ready=false; restrição segue enabled=false, versão 2. Sessão do navegador automatizado ainda pede MFA e não permite comprovar recuperação visual. A confirmação administrativa não remove a trava de cobertura; revisão profunda ainda aguarda notificação.
- Revisão 18/11 12:15 UTC: varredura rápida concluída; todos os achados retornados estavam previamente dispensados pelo usuário, sem novos achados acionáveis. Isso não equivale a aprovação integral. Revisão profunda iniciada, aguardando notificação de conclusão.
- Reexecução em 18/11: 33 testes aprovados. Navegador com sessão injetada chegou à verificação em duas etapas; não foi possível exercitar a gestão nem a recuperação sem a confirmação MFA. Nenhum código de autenticação solicitado no chat e nenhuma validação contornada.
- 33 testes aprovados: 7 de admissão, 8 de alçada única e 18 de reprocessamento.
- Build mais recente OK; `git diff --check` sem erros.
- Sessão injetada disponível ao script: status 200; gestão enable/disable/allow recusada 403 por ausência de MFA verificável, sem alteração de versão.
- Sessão da ferramenta administrativa com MFA: status 200 e seis contas corretas; enable recusado 403 pela trava de cobertura; disable executado 200 e lido de volta `enabled=false`, versão 2, auditoria atribuída a Hiller.
- Tentativa de remover Douglas recusada; vínculo preservado.
- Sete buckets privados confirmados. Após aprovação explícita de Hiller, quatro políticas restritivas de Storage foram aplicadas em 0078; nenhuma permissão adicional foi concedida e as políticas anteriores permanecem obrigatórias.
- Novas funções específicas e principais consumidoras da guarda foram implantadas; a revisão de todas as variantes/consumidoras ainda não está completa.
- Todas as consumidoras diretas de auth.ts localizadas e as principais verificações próprias foram republicadas; variantes técnicas ainda dependem da sua autenticação específica.
- Ensaio local PostgreSQL com dados exclusivamente sintéticos aplicou exatamente 0077/0078/0079 e passou: cinco pessoas admitidas, outro admin/sessão existente bloqueados, tabelas/anexos/RPC SQL e PL/pgSQL bloqueados, MFA obrigatório, responsáveis protegidos, conflito de versão recusado, reabertura individual e restauração por Douglas com quatro ações auditadas. Fixture e ensaio em scripts/tests/erp-access-fixture.sql e scripts/tests/erp-access-integration.py. Não representa verificação de sessões reais dos aprovadores ou navegador.

## Bloqueadores que impedem ativação
1. **Proteção de anexos aprovada e aplicada:** etapa concluída em 0078, SQL exato em `docs/erp-access-storage-proposal.sql`; ensaio sintético de leitura bloqueada/restaurada passou.
2. **RPCs privilegiadas:** admissão adicionada às 46 funções de recursos localizadas; verificadores de identidade, MFA, configuração de permissões e telemetria mínima permanecem fora do gate. Leitura do catálogo confirmou a cobertura aplicada, mas não todos os resultados de cada RPC com dados reais.
3. **Ensaio Test:** regra de acesso/rollback passou em PostgreSQL isolado; ainda falta ponta a ponta pelas sessões reais de Flow/SAP/OMIE, inclusive recuperação dos dois admins pelo aplicativo. O backend da prévia é o mesmo de produção: não ligar globalmente para realizar esse ensaio.
4. **Conferência visual:** executada até a barreira MFA em 18/11, nesta solicitação separada; sessão disponível exige nova confirmação. Gestão/recuperação pelo aplicativo ainda não exercitadas; não contornar nem afirmar que foram verificadas.
5. **Links emitidos e dados locais:** URLs já emitidas podem continuar válidas até a expiração; caminhos comuns têm TTL de 5–10 minutos e resend-missing-attachment-notifications usa sete dias. RLS nova não revoga esses links já assinados. Conteúdo já baixado não pode ser revogado remotamente. Não rotacionar chaves, apagar arquivos ou declarar bloqueio integral para contornar esse limite; requer decisão explícita sobre essa janela.

## Revisão de segurança desta mudança
- OK: sem novas chaves/segredos, UUIDs verificados, MFA preservado, auditoria, gestão parametrizada/validada, sem alteração de permissões de negócio, fail-closed nos verificadores.
- Não verificado globalmente: políticas permissivas antigas, todos os RPCs/entradas, criptografia de PII, configuração de signup/senhas, cabeçalhos/CORS do projeto inteiro e varredura contínua do repositório.
- **Não ativar / não declarar concluído** enquanto os bloqueadores acima persistirem.