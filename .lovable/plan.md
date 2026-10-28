# Liberar compras de André na Cactus Tecnologia

## Resultado
Permitir que `andre.coura@lotusblanca.net` crie compras na Cactus Tecnologia, mantendo seu papel de usuário comum e os acessos atuais dos demais usuários.

## Mudança restrita
- Preservar o bloqueio padrão do domínio Lotus fora da ANA Gaming.
- Permitir uma exceção explicitamente autorizada para uma pessoa e uma empresa, sem considerar a licença SAP como exceção automática.
- Registrar somente a exceção de André na Cactus Tecnologia, com autoria e auditoria, usando uma sessão administrativa com verificação em duas etapas.
- Manter grupos, regras de aprovação, projetos permitidos e demais pedidos inalterados.

## Validação
- Testar primeiro em banco isolado com dados sintéticos: André sem exceção é bloqueado; com exceção pode criar compras na Cactus; outro usuário Lotus continua bloqueado; André continua bloqueado em outras empresas; nenhum papel de administrador é criado.
- Conferir a permissão de criação pelo mesmo mecanismo utilizado ao criar compras e ler de volta a concessão e a auditoria.
- Não criar pedidos reais como teste. A confirmação final da criação deve ser feita por André após a liberação.

## Detalhes técnicos
- Adicionar `allow_domain_exception boolean NOT NULL DEFAULT false` a `user_company_access`, preservando suas políticas de acesso administrativo e os registros existentes.
- Ajustar apenas `user_can_access_company` para aceitar exceções explicitamente marcadas para o e-mail exato e a empresa exata; a autorização de módulo/ação continua em `has_module_action`.
- Aplicar a migração somente depois dos testes isolados. Não alterar `user_roles`, grupos de permissão ou funções de criação de pedidos.
- A sessão administrativa disponível está sem o segundo fator e não permite conceder o acesso. Não usar gravações privilegiadas para contornar essa proteção; concluir a concessão apenas quando houver uma sessão autorizada.

## Liberação
GO para a alteração somente após os testes isolados; NO-GO para declarar o acesso liberado enquanto faltar a verificação administrativa em duas etapas.