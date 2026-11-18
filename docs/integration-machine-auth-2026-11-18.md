# Automações com identidade independente

## Inventário confirmado

- 61 cron jobs ativos usam x-scheduler-secret consultado em system_credentials_v durante execução; zero agendamentos ativos usam x-api-key. Preservados.
- Dados - Lotus: expense-tracking-api, CASSINO/VERA, chave ativa com uso recente.
- Aprovações - Thiago Moreira: external-approvals-api, chave ativa; último uso em setembro.
- Ambas foram criadas por Matheus; autoria não equivale a aprovação do consumidor. Nenhuma foi promovida automaticamente.
- PAGCORP_STATUS_API_KEY e EXTERNAL_APPROVALS_API_KEY existem como configuração legada, sem autorização técnica nova.
- Script financeiro de planilha atualizado para assinatura e credenciais em propriedades privadas, sem literais. Cópias externas antigas não são alteradas pelo Flow; seus responsáveis devem trocar as credenciais previamente expostas e instalar o novo script em projeto privado, não compartilhado com usuários bloqueados.

## Contrato

Somente três APIs aceitam prova técnica. É preciso chave registrada em x-api-key, autorização ativa em integration_machine_grants, credencial exclusiva em variável INTEGRATION_MACHINE_<CONSUMIDOR>, empresas/ operações explícitas e validade. Status/ tracking permitem read; aprovações permitem list sem user_code. approve/reject jamais recebem exceção técnica. Projetos da autorização de tracking devem ser subconjunto dos projetos da chave.

Cabeçalhos: x-machine-id, x-machine-timestamp (segundos Unix), x-machine-nonce (16–128 caracteres alfanuméricos, _ ou -), x-machine-signature (HMAC-SHA256 hexadecimal). Nenhum segredo em URL. Timestamp tem janela de 60 segundos e nonce consumido atomicamente no banco. Cada requisição/página exige assinatura e nonce novos. Não seguir redirects.

Mensagem assinada, unida por LF sem LF final:

```text
erp-machine-v1
<grant UUID>
<service>
<timestamp>
<nonce>
<METHOD>
<pathname + search exatos>
<SHA256 hex do corpo UTF-8 exato; vazio para GET>
```

Assinatura cobre operação/corpo, caminho, parâmetros, serviço e identidade; servidor usa crypto.subtle.verify. Prova incompleta ou inválida nunca cai no caminho legado, mesmo com bloqueio desligado. Uma sessão pessoal apresentada sempre é verificada primeiro: usuário bloqueado não pode tentar fallback técnico. Empresas são filtradas também quando o cliente omite companyDb; projetos não são ampliados.

## Administração e ativação do consumidor

1. Responsável confirma consumidor e empresas/ projetos mínimos; não deduzir empresas de nomes ou atribuir autorização ao criador da chave.
2. Credencial exclusiva compartilhada pelo formulário seguro Cloud Secrets, com cópia pelo responsável para o ambiente privado da automação; não usar segredo global do agendador. Nenhuma credencial nova foi gerada ou instalada neste pedido, pois consumidor/escopos externos não foram confirmados.
3. Responsável administrativo de recuperação com MFA cadastra autorização inicialmente desligada. Tabela usa RLS e políticas individuais SELECT/INSERT/UPDATE/DELETE com erp_access_is_manager e auditoria existente. Nonces não são legíveis por anon/authenticated; RPC somente service_role. Nenhum admin ou perfil pessoal é criado.
4. Responsável instala assinatura no consumidor, testa consulta restrita e só então habilita sua autorização. Desativação/revogação é lida a cada chamada; sem cache.

## Verificação e limites

- 73 testes automatizados passaram (12 novos de autenticação técnica e regressão de 61 anteriores); assinatura/replay/expiração/escopos e regressão pessoal executados com dados sintéticos. Deno check dos helpers e git diff --check passaram; preview build OK. Nenhuma tarefa real nas contas de Mauricio/Juliana/Artur foi simulada como comprovada.
- Migration 0081 aplicada sem modificar gate, chaves antigas, papéis, perfis ou cron.
- As três APIs publicadas; chamadas com chave falsa e identidade técnica falsa retornaram 401, sem alterar pedidos/pagamentos. Zero autorizações técnicas cadastradas confirmado; os consumidores atuais não receberam exceção automática.
- Sem consumidor configurado não há teste positivo externo ponta a ponta: instalação de credenciais e validação do consumidor permanecem bloqueadas por seu responsável.
- GO para a proteção técnica; NO-GO para ativação global. Gate continua enabled=false/coverage_verified=false, versão 2; links anteriores e tarefas reais pessoais permanecem fora deste escopo.

## Revisão de segurança

### Retomada 18/11 16:43 UTC

- Decisão posterior do usuário: ignorar a configuração de ambas as automações e manter seu acesso atual. Cadastro/instalação externa removidos do escopo deste pedido, não concluídos. Nenhuma chave, empresa, perfil, credencial ou autorização técnica alterada. Sob bloqueio futuro, chamadas key-only continuarão sendo recusadas; manter acesso atual não autoriza bypass.
- Duas chamadas publicadas, uma por consumidor, com chave e sessão propositalmente inválidas retornaram 401. Isso comprova recusa dessas entradas, não autenticação válida com as credenciais salvas nem fluxo externo positivo.
- Status administrativo autenticado retornou HTTP 200 com manager=true; bloqueio desligado, ready=false e versão 2. Sem alteração de configuração, perfis ou chaves.
- Os dois nomes de credenciais estão presentes no Cloud. Inventário confirmou zero autorizações técnicas cadastradas. Lotus tem CASSINO/VERA como projetos da chave, não autorização de empresas; a chave Thiago não tem projetos definidos.
- 33 testes focados passaram em integration-machine.test.ts, integration-admission.test.ts e erp-access.test.ts: leitura assinada sintética, replay, assinatura expirada/adulterada, chave/serviço incorretos, revogação, escopo de empresa, decisões técnicas proibidas e ausência de fallback de pessoa bloqueada.
- Empresas aprovadas, localização dos consumidores e instalação externa continuam não confirmadas. A conexão disponível é Google Drive; isso não identifica nem comprova acesso aos ambientes de execução. Solicitar empresas e localização/responsável de cada consumidor antes de cadastrar escopos ou declarar consulta externa funcional. Nenhuma credencial foi lida, exportada ou instalada nesta retomada.
- NO-GO para instalação externa concluída, validação positiva real ou ativação global até essas informações e evidências serem fornecidas.

### Retomada: credenciais exclusivas

Na solicitação de 18/11 15:17 UTC, o usuário salvou INTEGRATION_MACHINE_LOTUS e INTEGRATION_MACHINE_THIAGO_APPROVALS pelo formulário seguro com opção de geração e cópia para o ambiente externo. O agente não recebeu os valores. expense-tracking-api e external-approvals-api foram republicadas; 73 testes sintéticos passaram novamente. Estado consultado permanece enabled=false/coverage_verified=false, versão 2, e zero autorizações técnicas cadastradas.

Salvar no Cloud não confirma instalação no consumidor externo. As perguntas sobre localização/responsáveis e empresas foram puladas; não há escopo seguro para habilitar essas autorizações nem evidência de consulta externa assinada. Credenciais no Cloud: concluído; configuração nos dois consumidores e teste positivo ponta a ponta: não verificados e pendentes dessas informações. Não declarar funcionamento externo ou GO global.

Skill revisao-seguranca-lovable: RLS/grants da alteração OK; autorização e entrada escopada OK; nenhum segredo novo no front/log/código; nonce/assinatura/timestamp OK. CORS não concede credenciais de navegador nem dispensa verificação da assinatura; não adicionar os cabeçalhos técnicos a clientes de navegador. HTTPS/SSO/MFA existentes preservados. Configuração global HSTS/CSP, criptografia PII, configurações hospedadas de auth e CodeQL/secret scanning não revalidados nesta alteração. A remoção de literais do script não revoga cópias históricas; rotação depende do responsável.

Arquivos: integration-machine.ts, integration-admission.ts, api-keys.ts, três entrypoints, dois testes integration-*, script hanaapi-finance-sheets.gs, migration 0081 e metadados gerados, AGENTS.md, roadmap.md e este relatório.