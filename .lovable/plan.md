# Backup de saída no Google Drive compartilhado

## Verificação inicial
- Conexão do projeto: **Matheus's Google Drive**. Esse nome não comprova o e-mail da conta.
- A consulta de identidade falhou; a listagem retornou **401: autorização Google expirada**. Não foi possível confirmar e-mail, listar nem criar no destino. Nenhum arquivo foi enviado.
- Reautorizar a conexão existente em [Configurações do Google Drive](https://lovable.dev/dashboard?connectors=&connector=google_drive&workspace=qSskxMhHH1z2j90i1oFg). Depois consultar `about.user.emailAddress`, testar listagem e criação de `ERP-Flow-Backup` na raiz `0AEGlkXe3D_4wUk9PVA`; reutilizar essa pasta na execução.
- Se faltar permissão, informar o e-mail confirmado para inclusão como **Gerente de conteúdo**, sem trocar de conta nem usar Drive pessoal.
- O agendamento antigo `backup-to-gdrive-6h` (job 69) já está inativo; mantê-lo assim.

## Limite obrigatório da plataforma
A exportação de tabelas de negócio em CSV/JSON é permitida. Para um backup integral restaurável, incluindo contas de login, usar **More → Database → Manage → Settings → Export project data**. Esse recurso não inclui arquivos de Storage, código de funções, segredos ou configuração dos provedores de login.

**Não implementar cópia automática dos buckets com credencial administrativa:** as instruções de backup do Lovable Cloud exigem baixar os arquivos por **More → Storage**. Os anexos devem ser transferidos ao Drive a partir desses downloads. A automação solicitada não pode ser apresentada como backup completo enquanto essa etapa estiver pendente. Não exportar contas de autenticação ou hashes de senha por código.

## O que será implementado
1. Evoluir `backup-to-gdrive`, mantendo contratos administrativos existentes e sem alterar telas ou regras de negócio.
2. Configurar `gdrive_backup_settings.folder_id` com a raiz compartilhada autorizada. Nunca fazer fallback para outro destino.
3. Criar/reutilizar `ERP-Flow-Backup`, com `LEIA-ME.txt`, `manifest.json`, `dados/<empresa>`, `dados/_global`, `arquivo-sap`, `indices` e `auditoria`. Documentar a transferência pendente dos anexos de todos os buckets solicitados.
4. Inventariar as tabelas de negócio de `public`; exportar CSV UTF-8 com BOM e separador `;` e JSON. Resolver empresa por vínculo com o documento quando não houver coluna direta, sem perder linhas sem empresa. Exportar documentos/cadastros SAP também nos nomes solicitados e auditoria por mês em CSV.gz.
5. Excluir credenciais, tokens, MFA, sessões, telemetria, logs técnicos, filas e idempotência. Revisar também colunas e conteúdo JSON de tabelas incluídas para não carregar segredos ou tokens em campos indiretos. Tabelas ambíguas não sensíveis entram marcadas no manifest; registrar exclusões e justificativas no LEIA-ME.
6. Sobrescrever os mesmos CSV/JSON, sem snapshots acumulados. Registrar arquivo, linhas, bytes, SHA-256 do conteúdo exportado e resultado. Hashes de credenciais nunca serão calculados ou exibidos.
7. Retomar exportação com cursor persistente por ciclo, fase, tabela, empresa e arquivo. Não carregar tabelas inteiras em memória. Falhas individuais permanecem pendentes para nova tentativa; nenhuma falha silenciosa.
8. Registrar cada execução em `gdrive_backup_settings` e `infra_backup_log`, com erro explícito de autorização Google ou de acesso ao Drive. Manter manifest **em andamento** enquanto houver falhas, anexos não transferidos ou arquivo SAP incompleto nas cinco empresas.
9. Criar uma única rotina diária às **06:30 UTC**, lendo o segredo do agendador do banco. Mesmo sem acesso Google, registrar o bloqueio e tentar novamente no dia seguinte. Uma chamada diária executa um lote limitado; trabalho não concluído continua no próximo dia, sem prometer um prazo antes de medir volume e vazão.

## Detalhes técnicos
- Usar exclusivamente o conector Google Drive já vinculado, com credenciais obtidas em tempo de execução, sem exibir valores.
- `supportsAllDrives=true` em chamadas Drive; listagens de arquivos com `includeItemsFromAllDrives=true`, `corpora=drive`, `driveId` autorizado e paginação completa.
- Implementar checkpoints e lock com lease, aquisição atômica e liberação em `finally`; mudanças de schema por migration, privilégios explícitos e RLS restrita. Progresso administrativo não ficará acessível a usuários comuns.
- Consultas de exportação somente sobre catálogo autorizado, com projeção de colunas revisada, ordenação estável, paginação e corte registrado. Documentar que exportações paginadas não são um snapshot transacional integral do banco.
- Usar uploads retomáveis, validar o suporte do conector antes de adotá-los e não persistir URLs de upload sensíveis como texto aberto. Preservar ID do arquivo no Drive e verificar conteúdo/tamanho antes de concluir.
- Identificar conclusão real do arquivo SAP com todos os tipos esperados de documentos e cadastros por empresa, não apenas os cursores que por acaso existirem; anexos ausentes/404 continuam registrados como pendência.

## Validação e entrega
- Testes com dados sintéticos: exclusões de segredos, associação empresa/documento, escape CSV e fórmulas de planilha, retomada, ausência de duplicação, compartilhamento, falha de acesso e critério de conclusão.
- Publicar a função e executar a primeira rodada autorizada; conferir estado persistido, cron e leitura de volta de um arquivo exportado quando a conexão estiver reautorizada.
- Informar conta Google confirmada, acesso, pastas/arquivos/MB, job diário e estimativa baseada em volume e vazão. Sem conexão válida, informar zero envios e prazo indeterminado.
- **NO-GO para backup completo** até reautorizar o Google, concluir exportações e arquivo SAP, e transferir os arquivos baixados de Storage.