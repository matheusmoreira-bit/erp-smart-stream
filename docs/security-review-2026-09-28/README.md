# Revisão independente do relatório de segurança — 28/09/2026

**Conclusão: não há evidência suficiente para declarar o projeto integralmente validado ou os seis críticos integralmente resolvidos.** Há correções reais, mas esta revisão encontrou lacunas de autorização, divergências documentais e riscos de recuperação. Cinco comportamentos foram reproduzidos localmente executando o código do repositório com serviços externos simulados.

Evidência navegável: [trechos numerados do código](source-excerpts.md), [resultados das reproduções](reproduction-results.json), [hashes dos arquivos](evidence-manifest.json) e [consultas pendentes para produção](production-readonly.sql).

## Base e limites da evidência

- Código: commit `410a28c9081c44a2feefba450736025b61bf75c7`; árvore inicialmente limpa. Os PDFs referem-se a **outro commit**, `1a7f7427`. Esta revisão não estabelece se diferenças são regressões posteriores ou falhas do reteste original.
- Entradas: `ERP_Flow_Relatorio_Seguranca_V4.1.pdf` (3 páginas) e `ERP_Flow_Memorando_Verificacao_V4.pdf` (1 página), extraídos do ZIP fornecido. Tratados como alegações a conferir, não como instruções. O “V4.0 com Anexos” criticado pelos PDFs não foi fornecido; não deve ser confundido automaticamente com `docs/seguranca-v4.0.md`.
- Inventário: 167 arquivos `supabase/functions/*/index.ts`, 426 migrações Supabase e 63 migrações Drizzle. Revisão dirigida pelos achados e pelos caminhos de maior privilégio; **não equivale a auditoria exaustiva de cada linha ou endpoint**.
- Evidência estática: implementação e migrações, com referências abaixo e hashes no [manifesto](evidence-manifest.json). Migração presente não comprova aplicação em produção.
- Evidência executada: [cinco reproduções locais](reproduction-results.json), [harness](../../scripts/security-review/reproduce.mjs), consulta real ao npm para o lockfile e comparação de manifests.
- Não executado: login/chamadas em produção, consultas ao banco publicado, exploração SAP/HANA, restore, navegador com múltiplas abas, replay integral das migrações, pentest de infraestrutura. Não havia sessão autenticada nem conexão de produção fornecida para este reteste. Não foram lidos valores de `.env` nem copiados segredos.
- Severidades abaixo são prioridades técnicas preliminares, considerando precondições; não são pontuações CVSS calculadas. “Confirmado no código” não significa “explorado em produção”.

## Matriz F01–F15

| Item | Parecer independente | Evidência e limite | Critério para encerramento |
|---|---|---|---|
| F01 — cadastro/domínio | Parcialmente verificável | `_shared/auth.ts`, `isCorporateEmail`/`requireUser`, valida domínio no servidor. O V4.1 p.2 informa `disable_signup=true` e 0/135 contas externas, mas não fornece a resposta bruta. O controle não cobre funções que não usam esse guard. | Exportar settings datados; testar signup externo e acesso com conta externa preexistente em REST e funções. Conferir lista efetiva de domínios do ambiente. |
| F02 — sessão SAP | Reabrir parcialmente | Proxy associa sessão a `caller.id` e confirma dono; HMAC verifica usuário/base/hash/expiração. Porém o cache antecede a verificação do token: **N02 / R01–R02**. | Rejeitar token ausente, inválido e expirado também com cache aquecido; testar troca de usuário/base e revogação. |
| F03 — ApiUser | Correção presente no proxy, escopo limitado | `sap-b1-proxy/index.ts:241`, `:258` e `:309`: login Cloud obrigatório, handle de serviço por usuário, bloqueio de `sapAction` e emissão de HMAC para handle. Há exceção explícita para admin fazer login com conta de serviço. | Testar cada ação do proxy com sessão pessoal/de serviço e conferir privilégios reais da conta no SAP. A proteção do proxy não prova segurança de todas as funções que usam credenciais de serviço. |
| F04 — PagCorp por texto | Vetor textual corrigido; autorização residual aberta | `_shared/pagcorp-expense.ts` e `expense-mutation/index.ts:463`: usa `origin`, exige módulo para PagCorp. Contudo o helper exige apenas `view`, e existe exceção Omie (**N03/N04**). | Texto “PagCorp” não altera fluxo; usuário sem `create` não pode enviar `origin=pagcorp` e obter aprovação automática; conferir header/base do documento. |
| F05 — CNAB | Controles reais, não encerrado globalmente | `accounts-payable-cnab/index.ts:1150` em diante recarrega títulos/perfil; `:1360` em diante verifica outro aprovador; Drizzle `0052`. Mas o dispatcher autoriza todas as ações com `view` e não vincula a empresa Cloud ao corpo (**N03**). | Além de dados bancários forjados e autoaprovação, negar geração/configuração/aprovação a leitor e empresa alheia; retestar concorrência e alteração após aprovação. |
| F06 — credenciais | Cifra implementada; descrição incorreta e rotação não comprovada | Drizzle `0053/0054`: `pgp_sym_encrypt(...,'cipher-algo=aes256')`, chave em `private.credential_keyring`; não AES-GCM nesse armazenamento. `credentials/index.ts:56` mascara valores sensíveis. Prefixo não comprova decriptação, algoritmo ou rotação. **N03/N07** afetam integridade/recuperação. | Inventário de segredos/classificação, prova de decriptação controlada sem exibir valores, rotação com datas e revogação na origem, recuperação da chave. |
| F07 — backup | Aberto quanto à recuperação demonstrável | `replica-sync` só copia incrementalmente `audit_trail` e `audit_trail_archive`; `db-backup-s3` inclui `public` e lista de usuários; restore não recria auth e não inclui keyring (**N07**). Runbook registra restore pendente. | Restore isolado completo com dados atualizados, exclusões, anexos, identidades, MFA, credenciais decriptáveis, RPO/RTO e evidência de retenção/imutabilidade. |
| F08 — HANA/SL | Aberto | `_shared/hana-views.ts:11` e `:168` contêm defaults HTTP. Não houve teste de alcance, negociação TLS nem leitura da configuração efetiva. HTTPS no hostname do SL não comprova allowlist. | Fornecedor comprovar HTTPS válido/sem downgrade e allowlist/túnel; testar caminhos efetivos e retirar fallback HTTP. |
| F09 — MFA | Reabrir cobertura | Drizzle `0060`, `requireUser` e copiloto exigem MFA em caminhos específicos. “4 fatores verificados” não comprova AAL2 da sessão nem enforcement universal. Alternativa SAP contorna 403 (**N02/R03**); lookup de papel falha aberto (**N08**). | Admin AAL1 negado em todos os caminhos sensíveis, inclusive SAP; falhas de RPC não dispensam MFA. Evidência de enrolamento separada da de enforcement. |
| F10 — copiloto | Spot-check parcialmente favorável; risco residual | Drizzle `0056`: role separado e restrição de colunas; `copilot-chat:820–845`: confirmação por dono/estado/prazo, consumo condicional. Estado global de ator (**N06**) e permissões de execução SQL ainda requerem testes. | Concorrência entre admins, confirmação de outro usuário, replay/expiração, leitura indireta de segredos, execução de funções com efeitos colaterais. |
| F11 — autoria/isolamento | Autoria direta melhorou; isolamento aberto | Drizzle `0057` deriva autor de `auth.uid()` para chamadas de usuário; backend informa ator. `company-access.ts` módulo shadow; Drizzle `0059/0061` exceção Omie; **N03/N04**. | JWT forjado rejeitado; autoria real persistida via REST e via funções; negar ações por módulo/base e remover exceções genéricas. |
| F12 — impersonação | Parcial, não universalmente encerrado | Proxy bloqueia ações de escrita; Drizzle `0058` cria policies restritivas nas tabelas existentes naquele momento. Helpers alternativos podem recuperar de 423 via SAP; cache/falha aberta **N08**. Tabelas criadas depois não recebem automaticamente essas policies. | Matriz de todas as escritas em Edge/REST/RPC/SAP sob impersonação, inclusive primeiro pedido/cache e tabelas novas; nenhuma escrita aceita. |
| F13 — logout/cache | Implementação presente, teste de navegador pendente | `clear-erp-local-state.ts:29–62` limpa prefixos e solicita exclusão de dois IndexedDB; chamadas no menu, contexto e evento de logout em `main.tsx`. Exclusão é assíncrona e sem aguardar sucesso/blocked/error. | Logout em duas abas, transações abertas, usuário A→B, reload e reconexão offline; verificar conclusão da exclusão, não só chamada da API. |
| F14 — IA/documentos | Parcial técnico e organizacional | OCR exige `requireUser`, limite 30/300s, tamanho 8MB, remove metadados JPEG/PNG. WebP/HEIC/PDF aceitos sem esse tratamento; conteúdo visual completo é enviado. **N09**. Política existe em `docs/politica-ia-documentos-lgpd.md`; arquivo não comprova aprovação. | Classificação por formato, minimização comprovada antes do envio, configuração/retenção do provedor, expurgo verificável e aprovação pelos responsáveis. |
| F15 — inventário/cron | Pendente de governança e prova | Runbook registra segredo em job e senha de réplica exposta; isso é uma declaração documental, não leitura dos segredos nesta revisão. Duas trilhas de migração (**N05**) e lockfiles divergentes (**N10**) afetam inventário reprodutível. | Inventário de empresas/ambientes/versões, origem e dono de cada segredo, rotação e substituição no cron, artefato de deploy reproduzível. |

## Novos pontos e reaberturas com evidência

Os IDs N01–N10 são próprios desta revisão; **não são os F16–F20 contestados pelo memorando**.

### N01 — Acesso a documentos fiscais sem autorização no handler — Alto

**Confirmado no código e reproduzido isoladamente (R04).** `supabase/functions/nf-entrada-fetch-file/index.ts:86–123` cria client service role, busca `nf_entrada_imports` pelo `import_id` informado e assina arquivo por dez minutos. Não valida usuário, vínculo com empresa nem acesso ao documento. Para arquivo não cacheado, também baixa e grava com privilégio de serviço. UUID conhecido é a precondição; não é necessário demonstrar enumeração para caracterizar ausência de autorização.

`supabase/config.toml` não tem seção específica para essa função: o padrão do gateway pode exigir JWT. **Não afirmo que ausência completa de headers ultrapassa o gateway publicado.** Um JWT válido não substitui autorização por documento; testar também chave anon legada se aceita pela configuração de deploy. Bucket privado não impede que uma função privilegiada distribua links indevidamente.

**Correção/aceite:** autenticar antes de ler; carregar empresa do registro; autorizar identidade, módulo e recurso; evitar fallback de credencial de outra empresa. Retestar usuário A com ID de B (403), anônimo (401), autorizado (200). Dono: backend/documentos.

### N02 — Cache SAP dispensa HMAC e fallback recupera recusas de MFA — Alto

**Reproduzido (R01–R03).** Em `_shared/auth.ts`, `getSapSessionValidationCacheKey` usa base/usuário/sessão/rota, sem token. `validateSapSession` retorna o cache antes de `verifySapAuthToken`; TTL de 300s não é limitado pelo `exp` do token. Depois de uma validação legítima, o mesmo conjunto de headers continua aceito com HMAC vazio ou expirado. Isso **não permite inventar uma sessão do nada**: requer conhecer sessão/base/usuário e acertar instância com cache aquecido.

`requireUserOrSapSession`, `requireAdminOrSapModule` e variantes capturam genericamente erros do caminho Cloud e tentam SAP. No teste, `requireUser` recusa admin AAL1 com 403 e o helper alternativo aceita a sessão SAP. A identidade Cloud da chamada não é comparada à identidade SAP nesse fallback. O mesmo padrão merece reteste para 423 e domínio recusado; esse caso adicional não foi executado no harness.

**Correção/aceite:** preservar recusas explícitas de MFA/impersonação/autorização; especificar quais identidades SAP podem operar sem Cloud; verificar prova e expiração em toda chamada; TTL limitado à expiração e invalidação por revogação. Dono: autenticação.

### N03 — Permissão de leitura permite escrita, com empresa do header distinta da empresa alvo — Crítico potencial

**Caminho reproduzido (R05), impacto real depende das permissões/deploy.** `_shared/auth.ts:547` em diante, `requireAdminOrSapModule`, consulta `has_module_action` com `_action: 'view'` e empresa do header; retorna `{...u, source:'cloud_module'}` sem empresa validada. `credentials/index.ts:28–41,70–120,130–145` só restringe empresa se `caller.companyDB` existir e usa corpo/query como alvo. Portanto uma identidade autorizada a **ver** módulo em A consegue alcançar POST de credenciais em B nesse caminho. O harness executou os handlers reais, simulando apenas resposta da RPC e persistência, e observou escrita em B após checagem `view` em A.

`accounts-payable-cnab/index.ts:1653–1685` repete o padrão para `save_config`, `generate`, aprovações e retorno. `expense-mutation` usa esse helper para origem PagCorp. Não afirmar que todo usuário pode fazer isso: depende de obter `true` da RPC — N04 amplia essa condição.

**Impacto:** alteração/exclusão de configurações e credenciais de integrações; escrita financeira além de `view`; acesso entre empresas. Alterar endpoints de integrações pode ampliar o impacto, mas exfiltração/SSRF não foi executada nem afirmada como comprovada.

**Correção/aceite:** derivar uma única empresa alvo no servidor e validar essa mesma empresa por ação (`edit`, `delete`, `approve`, `integrate` etc.); incluir escopo validado na identidade; exigir privilégio específico para credenciais. Testes leitor→POST e A→B devem negar antes de qualquer escrita. Dono: autorização/financeiro.

### N04 — Exceção Omie ignora permissões de módulo e vínculo individual — Alto; amplifica N03

**Confirmado nas migrações, aplicação em produção pendente.** Drizzle `0061_fix_has_module_action_canonical_identity.sql:29–35`: empresa Omie retorna `true` antes de consultar grupos ou usuário/email. Drizzle `0059_user_company_access.sql:40–45` permite vínculo com empresa Omie independentemente de vínculo individual (com exceção da restrição Lotus). Assim, para um usuário Cloud que passa `requireUser`, header apontando uma base Omie pode satisfazer autorização de `credentials`, `pagcorp` ou `financial_review` quando essa definição estiver aplicada.

Não é apenas “shadow”: a RPC retorna autorização positiva. Sem inventário de grants e deploy, não se conclui a quantidade de usuários afetados.

**Correção/aceite:** exigir vínculo explícito e ação por módulo também no Omie. Usuário corporativo sem vínculos deve obter `false` em cada módulo/ação e 403 nas funções. Dono: permissões/Omie.

### N05 — `make qa-migrate` não aplica a trilha das correções de segurança — Alto operacional

**Confirmado estaticamente.** `Makefile:39` em diante percorre apenas `supabase/migrations/*.sql`. Correções F05–F12/MFA estão em `drizzle/migrations/0052…0061`; `drizzle.config.ts` aponta para essa outra árvore. Banco inicializado apenas com o target anunciado como “reaplica migrations do repo” não recebe essas correções. O loop também não usa `set -e`/saída explícita por falha: `ON_ERROR_STOP=1` interrompe um processo psql, não necessariamente o loop inteiro, e a última iteração pode esconder falha anterior.

Não prova ausência em produção: pode haver pipeline separado. **Correção/aceite:** trilha canônica com controle de aplicação, parada na primeira falha, baseline e teste de banco vazio; comparar funções/policies efetivas com as versões esperadas. Dono: plataforma/deploy.

### N06 — Ator de confirmação do copiloto compartilhado entre requisições — Alto, interleaving não testado em runtime Deno

**Estado global confirmado; exploração concorrente ainda não demonstrada.** `copilot-chat/index.ts:352–358` mantém `pendingSb`/`pendingActor` em escopo de módulo. Cada pedido atribui ambos em `:813–814`; após awaits de gateway/ferramentas, `requireConfirmation` usa o ator global para gravar `user_id`. Em uma instância que processe pedidos concorrentes, A pode iniciar uma ação e B sobrescrever o ator antes da criação da pendência. A confirmação posterior valida o dono gravado, que já pode estar incorreto. Confirmar concorrência/isolamento do runtime publicado e o efeito funcional antes de declarar incidente.

**Correção/aceite:** passar client e ator por contexto da requisição. Teste com barreira determinística A pausa→B inicia→A grava; pendência de A deve pertencer somente a A. Dono: copiloto.

### N07 — Réplica parcial e chave de decriptação fora do backup lógico — Alto de disponibilidade

**Confirmado no escopo dos scripts; backup externo adicional desconhecido.** `replica-sync/index.ts:17` limita o incremental a duas tabelas de auditoria e usa `id > max(id)`: não replica alterações/exclusões antigas nem demais tabelas. `replica-storage-sync` cobre arquivos, não transforma essa rotina em réplica integral do banco.

`db-backup-s3/index.ts:38` enumera `public`; Drizzle `0053` mantém a chave em `private.credential_keyring`. `scripts/backup-restore.ts:4,45` não restaura usuários de auth. Restaurar ciphertext com uma keyring recém-gerada pelas migrações impede decriptação. MFA/identidades/referências precisam de procedimento próprio. Não foi demonstrado que não exista custódia externa da chave — apenas que esses scripts não a recuperam.

**Correção/aceite:** incluir procedimento seguro de recuperação da keyring, escopo completo de dados/autenticação, mapeamento de UUIDs e prova de restore; conferir duas credenciais sintéticas recuperáveis e relações de dados, sem registrar segredos. Dono: banco/infra.

### N08 — Controles de segurança falham abertos e têm janelas de cache — Médio/Alto conforme ação

**Confirmado no código; indisponibilidade não simulada.** `_shared/auth.ts`, `hasAdminRole`, converte erro de RPC em `admin=false`, cacheado 60s: MFA deixa de ser exigido no guard básico nessa condição. `isUserImpersonating` usa `hit?.active ?? false` em erro e cacheia por 10s; instância fria permite continuar. `validateSapSession` trata erro de revogação/desligamento como `false` e cacheia por 60s. Não significa que todo endpoint admin autorize: `requireAdmin` ainda faz segunda checagem e pode recusar. Também não existe prazo absoluto de sessão ativo: `assertMfaAndSessionAge` desliga explicitamente a checagem apesar dos nomes/constantes.

**Correção/aceite:** em ações sensíveis, erro de verificação deve bloquear com erro recuperável; cache de negação/permissão documentado e invalidado; testes de RPC indisponível, mudança de papel, revogação e início de impersonação. Dono: autenticação.

### N09 — Minimização de documentos não cobre todos os formatos/conteúdos — Médio

**Confirmado no código.** `expense-ocr-capture/index.ts:28,103–116,146–160` aceita WebP/HEIC/PDF, mas só trata JPEG/PNG. `_shared/ai-minimize.ts:62–71` devolve outros formatos/original em falha. Remover EXIF não mascara texto legível nos pixels. A instrução de não devolver dados bancários restringe a resposta do modelo, não a transmissão da imagem. `maskTextForAi` protege texto em caminhos que a usam, não todas as imagens. Não foi feita conclusão jurídica sobre conformidade.

**Correção/aceite:** política explícita de campos necessários, transcodificação/sanitização por formato ou recusa, máscara visual quando exigida, teste dos bytes realmente enviados e retenção do provedor. Dono: IA/privacidade.

### N10 — Dependências vulneráveis no lockfile e manifests divergentes — Alto de cadeia de dependências

**Consulta executada:** `npm audit --package-lock-only --json` retornou **25 entradas de pacotes: 1 crítica, 17 altas, 5 moderadas, 2 baixas**. Resultado completo em [npm-audit.json](npm-audit.json). Isso não significa 25 explorações possíveis em produção: há dependências de desenvolvimento, avisos transitivos/agrupados e condições específicas (ex.: servidor UI de Vitest para um dos avisos críticos).

A comparação do root de `package-lock.json` com `package.json` encontrou **25 divergências de especificação/presença**, em [lockfile-drift.json](lockfile-drift.json). Exemplo: React Router e dependências adicionadas têm versões/presença divergentes. Há também `bun.lock` e `bun.lockb`. Logo o audit npm **não representa automaticamente o bundle publicado ou a instalação Bun**, e não cobre imports remotos `esm.sh`/`npm:` do Deno nem imagens Docker. Não instalar dependências nem atualizar lockfiles foi necessário para esta coleta.

**Correção/aceite:** identificar gerenciador e lockfile usados no deploy, sincronizar manifests com alteração revisada, auditar o grafo efetivo e imagens/imports Edge, atualizar versões aplicáveis, build/testes e evidência de ausência dos advisories priorizados. Dono: frontend/plataforma.

## Interpretações que devem ser corrigidas nos documentos

1. V4.1 p.1 afirma “seis críticos resolvidos”, mas a própria p.2 deixa rotação F06 pendente. Cifra fecha um vetor, não elimina credenciais que já possam ter sido copiadas. Memorando repete conclusão ampla demais.
2. AES-GCM está presente em outros contextos (ex.: backup), mas não descreve `system_credentials` sob `0053/0054`. Não inferir algoritmo do prefixo `enc:v1`.
3. “4/4 fatores verificados” demonstra cadastro do fator; não demonstra AAL2 em todas as sessões, exigência em cada função ou segurança do reset. V4.1 e documento local também divergem quanto à pendência de cadastro; exigir registro datado.
4. RLS ativo em todas as tabelas, policies em grande quantidade, bucket privado e respostas 401 são evidências úteis, mas não provam autorização por empresa/recurso quando o backend usa service role. `USING(true)` para `service_role` não é achado por si só; para `authenticated` requer avaliar sensibilidade e escopo. Inspecionar definição efetiva após todas as migrações, não somar textos históricos.
5. Execuções de backup, réplica externa e checksum não comprovam restaurabilidade. O runbook local ainda marca restore pendente; o escopo concreto do incremental é duas tabelas.
6. Na árvore atual, busca em `src`, `supabase` e `drizzle` não encontrou `omie-webhook`, `expense-docs`, `mfa-reset`, `hr_payroll_data`, `role_contractor` ou `PrestadorAccess`. Isso apoia a crítica do memorando quanto às referências locais, **não prova a inexistência de objetos criados só no banco publicado**. Não reabrir F16/F17/F19/F20 com as evidências antigas. Para F18 sequer há descrição suficiente nos PDFs: indeterminado.
7. Ausência de `mfa-reset/index.ts` não demonstra que todo fluxo de reset seja seguro; ausência do bucket alegado não fecha autorização de URLs assinadas (N01). Conservar a distinção entre evidência inventada e classe de risco ainda possível.
8. Controles de F10 existem e a confirmação é realmente server-side; não classificá-lo como “SQL completamente livre sem proteção”. Porém `copilot_reader` é `BYPASSRLS`, grants usam nomes/colunas e blacklist lexical não é prova de ausência de funções com efeitos colaterais. Auditar privilégios efetivos, objetos novos e dados sensíveis em JSON/logs; esses vetores específicos permanecem hipóteses, sem PoC nesta revisão.

## Plano de fechamento com evidência exigida

| Prioridade | Ação | Evidência de aceite |
|---|---|---|
| P0 | N03/N04: separar ações e vincular empresa; revisar acesso a credenciais/CNAB/PagCorp | Testes negativos usuário leitor, sem grupo, Omie e troca header/corpo; nenhum write; log de decisão |
| P0 | N01: proteger documentos fiscais | Anônimo e outro tenant negados; dono autorizado; teste pelo gateway real |
| P1 | N02/N08: HMAC, expiração, MFA, impersonação e falha fechada | Testes frio/quente, token ausente/expirado, AAL1/AAL2, RPC com erro, revogação |
| P1 | N05/N07: migrações e restore | Banco vazio reproduz produção; primeira falha interrompe; restauração com dados/identidades/chave e RPO/RTO |
| P1 | N06/N10: concorrência e dependências | Ator isolado sob concorrência; audit do grafo efetivamente implantado; build validado |
| P1 | F06/F08: rotação e transporte | Registro de rotação sem valores, revogação anterior e teste TLS/allowlist do fornecedor |
| P2 | F13/N09/F14/F15 e policies abertas | Teste multia­bas/offline, captura de payload sanitizado, expurgo, aprovações e inventário |

Por item registrar: commit e versão implantada, ambiente, horário, identidade/papel/base fictícios, precondições, pedido sanitizado, resposta/código, efeito persistido, conclusão e responsável. Guardar resposta negativa **e controle positivo**, para distinguir proteção de simples indisponibilidade. Não registrar JWTs, senhas ou documentos reais nos artefatos de auditoria.

## Reprodução e coleta pendente

Execute na raiz, com Node 24 ou superior:

```sh
node scripts/security-review/reproduce.mjs
```

O harness transforma TypeScript do repositório com o compilador embutido do Node, substitui somente fronteiras externas e não acessa rede/banco. O JWT sintético não é uma falsificação aceita pelo serviço real: `getClaims` é simulado para isolar decisões de autorização. Os cinco testes **passam quando reproduzem a falha observada**; após correção, suas asserções devem ser invertidas para testes de regressão. O warning experimental do transformador Node não afetou execução.

[production-readonly.sql](production-readonly.sql) contém consultas preparadas, **ainda não executadas**, para conferir banco, grants, MFA, policies, cifra por prefixo e objetos contestados. Executar primeiro em ambiente controlado com schema equivalente e operador autorizado; o SQL pressupõe as funções/roles desta revisão. Uma migração ausente pode abortar a transação e deve ser registrada como divergência, não ignorada. O script não altera dados nem imprime valores de credenciais ou comandos de cron.

Para concluir validação operacional faltam: export datado de settings/deploy/migrações; resultados dessas consultas; contas de teste por papel/empresa/AAL; ambiente isolado para retestes e restore; evidências do fornecedor para rede/TLS. **Nenhum item dependente desses dados foi marcado como validado em produção.** Esta entrega adiciona documentação e ferramentas de evidência; não altera a aplicação nem implanta correções.

## Referências primárias para os critérios

- [Supabase — configuração de funções](https://supabase.com/docs/guides/functions/function-configuration): verificação de JWT no gateway é configurável; deve ser separada da autorização no handler.
- [Supabase — autenticação e headers](https://supabase.com/docs/guides/functions/auth-headers): distinguir chave de aplicação e identidade do usuário.
- [Supabase — JWT](https://supabase.com/docs/guides/auth/jwts): validar assinatura/claims, não apenas decodificar payload.

As referências explicam os critérios; a evidência dos achados é o código versionado e os resultados anexos.
