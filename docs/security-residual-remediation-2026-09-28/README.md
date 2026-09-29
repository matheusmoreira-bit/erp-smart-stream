# Correção das brechas residuais — candidata V4.2

28/09/2026. Alterações locais sobre `ff8676ddb80e1f48d6e5bd16fbf8305180fa356a`, sem implantação. Esta rodada implementa correções no sistema; não apenas revisa os estados do PDF. Sem acesso ao Supabase remoto ou ao SAP. O PDF anterior continua sendo o registro da revisão anterior; este documento prevalece para o andamento desta rodada.

## Alterações verificadas

| Referência | Problema confirmado no código | Correção | Evidência |
|---|---|---|---|
| F05 / B19 | Aprovação podia responder sucesso após perder a disputa pelo lote; arquivo vazio não tinha hash conferido. | Aprovação exige arquivo/hash, verifica o resultado da atualização condicional e revalida SHA-256 dentro da transação de aprovação. Arquivo, aprovador e dados dos títulos aprovados têm edição bloqueada por trigger. | `handler-tests.txt`: autoaprovação, hash, disputa, controle positivo. `database-tests.json`: hash atômico, segregação e edição bloqueada. |
| F05 / B19 | Retorno selecionava títulos de outros lotes da mesma empresa; lote cancelado e valor diferente não eram bloqueados suficientemente. | Empresa + lote + referência e valor pago positivo igual ao aprovado; remessa cancelada/sem aprovação recusada antes do pagamento. | `handler-tests.txt`: negativos e retorno permitido. |
| F05 / B19 | Reserva de pagamento expirava em dez minutos; falha após POST virava erro retentável. | Migração 0066 retira expiração; resposta incerta e falha de persistência após POST mantêm o título reservado. Processamento do lote também tem aquisição condicional. | `database-tests.json`: concorrência/TTL; `handler-tests.txt`: timeout após envio, persistência falha e repetição sem segundo POST. |
| F05 / B19 | Transporte compartilhado repetia também escritas em erros transitórios. | Repetição automática só para GET/HEAD. POST/PATCH/DELETE têm uma tentativa, mesmo com `maxAttempts` maior. Abort do solicitante é respeitado. | `handler-tests.txt`: métodos, HTTP 503, rede, cancelamento e leitura recuperada. |
| F08 / B07 | HANA usava destinos HTTP fixos e enviava a sessão a um endereço alternativo; monitor cruzava endpoints de empresas. | HANA usa apenas HTTPS configurado para a empresa, sem fallback; transporte SAP compartilhado e reconciliação exigem HTTPS; redirecionamentos bloqueados nos caminhos tratados. | `handler-tests.txt`: HTTP/URL com credencial recusados antes da rede, HTTPS permitido, nenhum fallback. Certificados reais não foram testados. |
| F09 / B04 | Prazo absoluto de sessão estava desativado e consulta do início falhava aberta. | Guard compartilhado exige sessão existente, início válido e limite de 12h para admin/30 dias para usuário. Renovação do token não reinicia o prazo. | `handler-tests.txt`: sessão recente, expirada, ausente e consulta indisponível. |
| F11/F12/F15 / B01/B09/B13 | `sap-user-credentials` inteiro era permitido na impersonação; reconciliação aceitava usuário sem escopo; monitor HANA não autenticava no handler. | Impersonação só permite GET de credenciais; sincronização de perfil e reconciliação saem da lista de leitura. Reconciliação exige `fiscal_audit.integrate` na empresa real, execução global exige admin ou identidade técnica. Monitor exige admin ou service role antes de ler credenciais. | `handler-tests.txt`: GET legítimo, escritas negadas, identidade, empresa, execução global, admin e scheduler. |
| F13 / B10 | Snapshot só particionado por usuário; callbacks e cache IA podiam sobreviver à troca de contexto. | Rascunhos e cache IA persistente usam usuário + empresa; cache IA em memória usa usuário + geração local. Logout invalida operações pendentes entre abas; outbox confere a geração; timers e retornos do processamento IA verificam contexto antes de persistir/exibir. | `browser-tests.json`: nove cenários, Chrome/IndexedDB reais, incluindo controle positivo, outra empresa, outro usuário e resultado tardio. Auth e circuito ERP simulados. |
| F14 / B11 | Falha de limpeza JPEG/PNG enviava o original; WebP não removia EXIF/XMP. | JPEG/PNG/WebP malformados nos caminhos tratados são recusados. WebP remove EXIF/XMP e ajusta cabeçalho; JPEG processa segmentos entre scans e descarta bytes após EOI. OCR retorna 400 em erro de validação desses formatos. | `image-tests.json`: imagens sintéticas reais nos três formatos; metadados removidos, dimensões/pixels preservados, arquivos truncados recusados. |
| B13/B14 | Inventário incompleto e loop `qa-migrate` podia continuar após falha. | Inventário estático de 167 handlers; Make interrompe na primeira falha. | `function-inventory.json`; `migration-runner-test.json`: primeira falha interrompe, sem conexão ao banco. Isso não prova replay integral nem inventário produtivo. |

Os [trechos literais](source-excerpts.md) e o [manifesto de hashes](manifest.json) identificam exatamente os arquivos desta rodada. Não usar a ausência de um nome de guard no inventário como prova de exploração: wrappers, autenticação própria e gateway exigem revisão individual.

## Validação executada

- 37 testes de handlers/transporte/identidade passaram: 17 regressões ampliadas + 12 da V4.2 anterior + 8 residuais. Fronteiras de rede/ERP/banco simuladas.
- 10 cenários SQL passaram em PostgreSQL local real, banco sintético descartado ao final. Estrutura reduzida de CNAB; não é replay das migrações de produção.
- 9 cenários de navegador passaram, incluindo IndexedDB e troca de aba.
- 3 formatos de imagem passaram por remoção de metadados sintéticos e decodificação real no Chrome. Não é uma bateria completa de codecs.
- Build e TypeScript do frontend passaram.
- Vitest: 247 passaram, 49 ignorados, 1 falha anterior em `report-pdf.test.ts:179`.
- Deno: os mesmos 33 erros principais antes/depois nas quatro rotas conferidas; 34 diagnósticos contando a nota de tipo, sem adições por mensagem/arquivo. Checagem ainda reprovada.

Não somar esses números como percentual de cobertura. Há testes sobrepostos.

```sh
node --test scripts/security-review/regression.test.mjs scripts/security-review/v42.test.mjs scripts/security-review/residual.test.mjs
node scripts/security-review/residual-database.mjs
node scripts/security-review/browser-local-state.mjs
node scripts/security-review/image-minimize.mjs
node scripts/security-review/inventory.mjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
npm test
npm run build
```

## Condições para implantar sem interromper os fluxos legítimos

1. Aplicar **0066 depois de 0052/0063/0064**, antes do handler CNAB novo. Homologar a trilha canônica completa: o script SQL desta rodada não a substitui.
2. Configurar HTTPS válido e direto para `hana_api_url` e Service Layer. O código não transforma um servidor HTTP em HTTPS e não ignora certificados. Endpoints HTTP ou com redirecionamento passarão a ser recusados. Não implantar os consumidores novos antes de preparar o fornecedor.
3. Conferir o grupo `fiscal_audit.integrate`, admin do monitor e identidade dos agendamentos. Cron de reconciliação com `RECONCILE_CRON_KEY` continua suportado. Chamadas humanas mantêm verificação de sessão/MFA/impersonação.
4. Sessões Cloud acima do prazo precisam de saída e nova entrada. Renovar apenas o access token não basta. O guard utiliza a RPC `session_started_at` da migração 0060.
5. Reconciliar **pagamentos CNAB legados em `sap_error`/`sap_processing`** antes de retentar; estados antigos podem representar gravação remota já concluída. Não liberar reserva apenas por tempo. Comprovar worker encerrado, procurar `Reference2 = company_reference` no SAP, conferir fornecedor, documento, valor e data, então vincular sob controle operacional. Nesta rodada não foi criado botão de destravamento nem reconciliação automática de CNAB.
6. Valores de retorno diferentes do aprovado (inclusive juros/descontos) exigem reconciliação e decisão explícita. Não ajustar silenciosamente o título aprovado. Processos interrompidos podem deixar lote `processing`; a reserva permanece até análise assistida.
7. Rascunhos/cache IA antigos sem empresa não são migrados para uma empresa presumida. Exportar/concluir pendências antes de atualizar. Ao trocar empresa, o modal limpa o contexto anterior e restaura somente o snapshot da empresa escolhida.

## Estado de todos os itens citados pelo solicitante

| Item | Estado após esta rodada / restante |
|---|---|
| F01 | Validação do ambiente pendente: signup, domínios, contas e acessos com autenticação própria. Não foi alterada a política de domínios. |
| F02 | Correção anterior preservada e regressões repetidas; carga e deploy pendentes. |
| F03 | Cobertura dos consumidores e privilégios efetivos da conta SAP ainda pendentes. HTTPS/retry dos helpers não substituem essa revisão. |
| F04 | Correção anterior preservada; homologação PagCorp/alçadas pendente. |
| F05 | Novos vetores de lote, integridade, concorrência e repetição tratados localmente. Homologação bancária/SAP, conta favorecida e concorrência de edição/aprovação de perfil bancário permanecem pendentes. |
| F06 | Rotação/revogação e custódia dependem dos provedores; não executadas. |
| F07 | Restore completo com auth/chaves/anexos continua aberto. Testes SQL sintéticos não são evidência de recuperação. |
| F08 | HTTP/fallback removidos dos caminhos citados; provisionamento TLS, restrições de rede e consumidores diretos restantes dependem de revisão/homologação. |
| F09 | Prazo e estado de sessão tratados no guard compartilhado; endpoints com autenticação própria, Auth real e política IdP ainda precisam de cobertura. |
| F10 | Isolamento de confirmação anterior preservado. SELECT/EXECUTE efetivos, funções privilegiadas e leituras indiretas continuam abertos; nenhuma alteração global de grants foi aplicada sem mapa de dependências. |
| F11 | Reconciliação por empresa e execução global tratadas. Inventário de outros consumidores e REST/RPC ainda aberto. |
| F12 | Escritas indevidamente liberadas no guard tratadas. Matriz completa de REST/RPC/Storage/SAP e tabelas posteriores continua aberta. |
| F13 | Partições e resultados tardios tratados nos caminhos citados. Requisições já aceitas pelo servidor não são desfeitas pelo logout; fluxo Auth real, demais caches e concorrência de envio entre abas permanecem em revisão. |
| F14 | Cobertura de JPEG/PNG ampliada e WebP incluído. PDF, HEIC, GIF, imagens remotas de `supplier-ai-extract`, campos visíveis nos pixels, políticas de retenção e aprovação de provedor ainda abertos. Remover EXIF não anonimiza o documento. |
| F15 | Monitor HANA protegido e inventário estático criado. Recertificação, jobs publicados, segredos técnicos e demais endpoints ainda pendentes. |
| Extra / B12–B15 | Replay integral, inventário produtivo de grants/policies, grafo de dependências implantado e SBOM continuam abertos. |
| N01–N04 | Correções anteriores preservadas e suíte repetida; implantação/legados ainda pendentes. |
| FUNC-01 | Teste do PATCH completo repetido na suíte de handlers; incidente real e add-ons SAP aguardam homologação. |

Referências de formato utilizadas: [PNG, W3C](https://www.w3.org/TR/png-3/) e [WebP, RFC 9649](https://www.rfc-editor.org/rfc/rfc9649.html). As evidências acima são locais e não declaram encerramento operacional de todos os achados.

## Integração com o remoto — 29/09/2026

Os commits remotos até `750e9d4d` foram preservados. A migração de segurança foi renumerada de 0065 para **0066**, pois o remoto já contém `0065_cactus_providers_disable_standalone`. O SQL não mudou; referências e journal foram ajustados. O teste SQL foi repetido após a renumeração, com resultado em `database-tests-after-rebase.json`. Os logs anteriores permanecem históricos.
