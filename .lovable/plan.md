# Bloqueio reversível de acesso ao ERP Flow

## Resultado
- Com o modo restrito ativo, **Mauricio Farias, Juliana Gavineli e Artur Angelo** usam o ERP Flow, com as permissões que já possuem.
- **Hiller e Douglas Vinicius também mantêm acesso ao ERP como administradores, com MFA**, inclusive para liberar uma pessoa ou restaurar o acesso geral; demais administradores não recebem exceção automática.
- Contas, vínculos, permissões, histórico e credenciais não são apagados nem alterados pelo bloqueio.
- A gestão terá três ações: **ativar restrição**, **liberar/remover uma pessoa da lista** e **restaurar acesso geral**. Restaurar significa voltar às autorizações anteriores, não conceder acesso irrestrito.

## Implementação por fases
1. **Preparar sem bloquear:** confirmar as cinco identidades corporativas e responsáveis pela recuperação; criar o controle inicialmente desligado e a gestão administrativa. Há duas contas administrativas de Hiller cadastradas; vincular as exceções explicitamente às identidades verificadas, nunca a todos os administradores. Confirmar o vínculo administrativo de Douglas pelo caminho autenticado existente, sem promover outras contas.
2. **Proteger todas as entradas:** aplicar a mesma restrição às operações autenticadas, consultas diretas, documentos e anexos, sessões SAP/OMIE e aprovações por links. Só Hiller e Douglas têm a exceção administrativa solicitada. Sessões já abertas passam a ser recusadas nas próximas requisições; a tela bloqueada não monta nem carrega o ERP.
3. **Preservar recuperação e automações:** Hiller e Douglas podem gerenciar a restrição com MFA e acesso administrativo validado. Rotinas internas agendadas continuam sob sua autenticação própria, sem aceitar essa exceção para chamadas de usuários. Registrar alterações e recusas sem expor segredos.
4. **Testar em Test antes de Live:** usar dados sintéticos e testar os três usuários permitidos, Hiller e Douglas administradores, usuário bloqueado, outro administrador bloqueado, sessão já aberta, acesso direto, anexos, aprovações por link e recuperação pelos dois administradores autorizados. Testar liberação individual e restauração geral, inclusive rollback da configuração.
5. **Ativar somente após validação:** implantar toda a proteção com a restrição ainda desligada; ativar por operação administrativa com MFA, após conferir cobertura e recuperação. Ler de volta a configuração e informar o estado real. Se houver lacuna de segurança, manter desligado e informar NO-GO.

## Identidades confirmadas
- Mauricio: `mauricio.farias@anagaming.com.br`.
- Juliana: `juliana.gavineli@anagaming.com.br`.
- Artur: `artur.angelo@anagaming.com.br`.
- Hiller: existem contas administrativas nos domínios growth.gg e cactuscorporation.com; usar identidade autenticada e papel administrativo validado, sempre com MFA.
- Douglas: diretório vincula `douglas.vinicius@anagaming.com.br`; confirmar aliases corporativos e vínculo administrativo existentes antes de ativar. Não escolher uma conta só pelo nome.

## Detalhes técnicos
- Configuração central versionada, lista de identidades canônicas e responsáveis de recuperação separados; alteração transacional com auditoria e proteção contra concorrência.
- Autorização baseada em identidade validada no servidor, nunca texto digitado, cabeçalhos declarados, domínio isolado ou armazenamento local.
- Guardas compartilhadas para funções; inventário das funções que não usam essas guardas, RPCs SECURITY DEFINER e caminhos de autenticação alternativos para evitar bypass.
- Restrição adicional de acesso a dados que não substitui nem amplia as políticas existentes; tabelas novas com GRANT explícito, RLS e políticas escopadas. Qualquer alteração necessária no Storage terá SQL exato apresentado para aprovação antes de aplicar, respeitando a regra vigente de anexos.
- Verificar URLs de anexos já emitidas e caches/offline: conteúdo previamente baixado não pode ser recolhido remotamente; documentar eventual janela de expiração e não declarar bloqueio integral sem avaliá-la.
- Tela com carregamento, acesso bloqueado, erro e estado desatualizado; falha de verificação não libera acesso. Consulta de status mínima, sem dados do ERP, com atualização após mudanças.
- Testes pequenos de regras de acesso e integração no servidor; verificação visual em solicitação separada, conforme a regra do projeto.

## Limites e critério de conclusão
- O bloqueio é do **ERP Flow**, não das contas diretamente no SAP, OMIE ou Okta.
- Nenhuma mudança em alçadas, senhas, permissões de negócio ou validações de MFA.
- Não remover dados já copiados para fora do aplicativo.
- **GO** somente com bloqueio server-side e recuperação comprovados; falta de sessão administrativa MFA verificável ou cobertura incompleta impede ativação.
- Entrega: arquivos alterados, testes executados, riscos restantes e estado do bloqueio. Nesta etapa de planejamento, **nenhum usuário foi bloqueado**.