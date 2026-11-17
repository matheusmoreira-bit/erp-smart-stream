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

## Verificado
- 33 testes aprovados: 7 de admissão, 8 de alçada única e 18 de reprocessamento.
- Build mais recente OK; `git diff --check` sem erros.
- Sessão injetada disponível ao script: status 200; gestão enable/disable/allow recusada 403 por ausência de MFA verificável, sem alteração de versão.
- Sessão da ferramenta administrativa com MFA: status 200 e seis contas corretas; enable recusado 403 pela trava de cobertura; disable executado 200 e lido de volta `enabled=false`, versão 2, auditoria atribuída a Hiller.
- Tentativa de remover Douglas recusada; vínculo preservado.
- Sete buckets privados confirmados. Nenhuma política de Storage alterada.
- Novas funções específicas e principais consumidoras da guarda foram implantadas; a revisão de todas as variantes/consumidoras ainda não está completa.

## Bloqueadores que impedem ativação
1. **Aprovação da proteção de anexos:** a regra vigente exige aprovação explícita do SQL antes de mudar políticas de Storage. Proposta exata em `docs/erp-access-storage-proposal.sql`; só restringe e não concede novos acessos.
2. **RPCs privilegiadas:** várias funções SECURITY DEFINER acessíveis ao cliente contornam RLS por desenho; todas precisam de admissão explícita ou cobertura comprovada antes da ativação. Inventário encontrou, entre outras, `get_nf_entrada_cache_by_po`, `list_baixas_by_invoice`, consultas de substituição e diretoria.
3. **Ensaio Test:** falta testar bloqueio ativo, sessão existente, admissão individual, restauração geral e recuperação dos dois administradores em ambiente isolado. O backend da prévia é o mesmo de produção: não ligar globalmente para realizar esse ensaio.
4. **Conferência visual:** não executada, conforme exigência de navegador em solicitação separada. A sessão do script não carrega MFA verificado; não contornar nem afirmar que a tela administrativa foi exercitada.
5. **Links emitidos e dados locais:** URLs já emitidas podem continuar válidas até a expiração; caminhos comuns têm TTL de 5–10 minutos, notificações podem usar janela maior. Conteúdo já baixado não pode ser revogado remotamente. Revisar todos os emissores antes de declarar bloqueio integral.

## Revisão de segurança desta mudança
- OK: sem novas chaves/segredos, UUIDs verificados, MFA preservado, auditoria, gestão parametrizada/validada, sem alteração de permissões de negócio, fail-closed nos verificadores.
- Não verificado globalmente: políticas permissivas antigas, todos os RPCs/entradas, criptografia de PII, configuração de signup/senhas, cabeçalhos/CORS do projeto inteiro e varredura contínua do repositório.
- **Não ativar / não declarar concluído** enquanto os bloqueadores acima persistirem.