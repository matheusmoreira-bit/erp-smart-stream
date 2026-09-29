"""Build the authored cyber assessment from recorded repository evidence (no remote I/O)."""
from pathlib import Path
from html import escape as e
import subprocess,json,hashlib
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/reports'
COMMIT=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
BASE=f'https://github.com/matheusmoreira-bit/erp-smart-stream/blob/{COMMIT}/'
pages=[]
def p(text): return '<p>'+text+'</p>'
def note(text): return '<aside>'+text+'</aside>'
def ul(items): return '<ul>'+''.join('<li>'+x+'</li>' for x in items)+'</ul>'
def table(head,rows,widths=None):
 cols='<colgroup>'+''.join(f'<col style="width:{w}%">' for w in widths)+'</colgroup>' if widths else ''
 return '<table>'+cols+'<thead><tr>'+''.join('<th>'+x+'</th>' for x in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+str(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'
def link(path,label=None):return f'<a href="{BASE}{path}">{e(label or path)}</a>'
def page(k,title,subtitle,body):
 pages.append(f'<section class="page"><div class="eyebrow">ERP FLOW / CYBER ASSESSMENT 4.2 <span>{k}</span></div><h1>{title}</h1><div class="subtitle">{subtitle}</div>{body}</section>')
def h(title):return '<h2>'+title+'</h2>'
page('01','Cyber Assessment<br><span class="accent">Versão 4.2</span>','Relatório técnico de andamento • 28 de setembro de 2026',
 '<div class="cover-rule"></div>'+p('<b>Segurança, integridade das integrações e rastreabilidade das correções do ERP Flow.</b> Esta emissão consolida a avaliação V4.1, duas rodadas de tratamento e a revisão adicional N01–N04, com evidências vinculadas ao código.')+
 '<div class="cards"><div><strong>4</strong>novos achados tratados no código<br><small>N01–N04; reteste de ambiente pendente</small></div><div><strong>20</strong>itens de backlog acompanhados<br><small>escopo integral ainda em execução</small></div><div><strong>0</strong>encerramentos operacionais declarados<br><small>nesta consolidação</small></div></div>'+
 h('Parecer de acompanhamento')+p('Há avanço técnico comprovável em autorização, sessões SAP, MFA, isolamento de contexto, limpeza local e prevenção de duplicidade de Drafts. Os vetores tratados possuem testes positivos e negativos. <b>Isso não comprova a implantação nem encerra as brechas no ambiente publicado.</b>')+
 p('Permanecem pendências de rotação de segredos, restauração, TLS, revisão global de privilégios, dependências e homologação de fluxos completos. Não se atribui risco residual “nulo” ou certificação de segurança ao sistema.')+
 note('<b>Estado da emissão:</b> documento V4.2 de acompanhamento. Correções implementadas no repositório; implantação e aprovação operacional não comprovadas. Nenhum acesso ao Supabase remoto ou SAP foi realizado nos ensaios registrados.')+
 '<div class="meta">Commit de referência<br><code>'+COMMIT+'</code><br><br>Preparação: revisão técnica assistida e evidências do repositório.<br>Responsável pelo aceite / revisor independente: não registrados.<br>Distribuição recomendada: interna, para Engenharia, Segurança, QA e donos do processo.</div>')
page('02','Escopo e método','O que foi examinado — e o que a evidência permite concluir',
 table(['Base','Uso e limite'],[
 ['V4.1 e memorando de verificação','Referência de F01–F15 e pendências originais. Relatos de reteste ao vivo não foram repetidos em produção.'],
 ['V4.0, anexos, DOCX e avaliações anteriores','Histórico e confronto de alegações; não prevalecem sobre evidência de código e execução correspondente.'],
 ['Código, migrações e callers','Revisão direcionada de handlers, helpers compartilhados, frontend e trilha Drizzle. Não é inventário exaustivo de toda a aplicação.'],
 ['Ensaios locais','Handlers reais com fronteiras Auth/DB/ERP simuladas; PostgreSQL local com fixtures; Chrome com IndexedDB real. Sem dados de negócio reais.'],
 ['Manifestos e saídas de testes','Permitem conferir arquivos e resultados registrados. Hash comprova correspondência de bytes, não implantação, autoria de produção ou eficácia operacional.'],
 ],[27,73])+
 h('Vocabulário de estados')+table(['Estado','Significado'],[
 ['Implementado / validado localmente','Código alterado e cenários descritos exercitados; não equivale a fechamento operacional.'],
 ['Parcial / em andamento','Parte dos controles existe; cobertura, integração ou critério de aceite ainda incompleto.'],
 ['Validação pendente','Não há evidência suficiente para concluir; não representa automaticamente exploração comprovada.'],
 ['Dependência externa','Ação/evidência depende de infraestrutura, fornecedor ou dono de processo; não é aceite de risco.'],
 ['Não sustentado','Alegação histórica sem correspondência suficiente no material examinado; não conta como correção entregue.']],[30,70])+
 h('Limites da avaliação')+ul(['Gateway publicado, settings, grants produtivos, identidades reais, SAP/add-ons e scheduler implantado não foram inspecionados ao vivo.', 'Ausência de autorização no handler não prova acesso anônimo ao gateway; RLS de usuário não limita automaticamente um client com service role.', 'Os testes são registros de execução anteriores a esta emissão. A geração do PDF reconferiu os hashes da rodada 4.2, sem reexecutar suites ou aplicar migrações.', 'P0/P1/P2 são prioridades propostas, não SLAs aprovados ou pontuações CVSS. Não há aceite formal de risco anexado.'])+
 p('Fontes de consolidação: '+link('docs/backlog-seguranca-v4.1.md','backlog V4.1')+'; '+link('docs/seguranca-v4.2.md','registro V4.2')+'; '+link('docs/security-additional-review-2026-09-28/README.md','revisão adicional')+'.'))
page('03','F01–F08: evolução','Severidades históricas mantidas para rastreabilidade; estado atual é o desta coluna',
 table(['ID / tema','Estado e avanço na V4.2','O que falta'],[
 ['F01 • Crítico<br>Cadastro/domínio','Validação pendente. Guard de domínio existe; números de contas/settings são alegações históricas.','Export datado, cobertura das rotas e versão implantada. B20.'],
 ['F02 • Crítico<br>Identidade SAP','Implementação local do vetor de cache: HMAC e expiração em cada chamada; revogação/desligamento falham fechado.','Reteste publicado, latência e carga sem caches permissivos. B03.'],
 ['F03 • Crítico<br>ApiUser no browser','Vetor original do proxy tratado no código: vínculo ao caller e handle de serviço.','Cobertura de demais consumidores e privilégio SAP da conta técnica. B01/B20.'],
 ['F04 • Crítico<br>Exceção PagCorp','Vetor textual já tratado; autorização da origem passou a exigir ação create e empresa no guard.','Integração completa e perfis legítimos; outros consumidores. B01.'],
 ['F05 • Crítico<br>CNAB/favorecido','Dispatcher agora exige ação correspondente na empresa do corpo; testes das 12 ações.','Hash, autoaprovação, retorno e replay financeiro completo. B19.'],
 ['F06 • Crítico<br>Segredos','Cifra existente; não há prova de rotação/revogação ou recuperação da chave.','Rotacionar segredos expostos e testar custódia/recuperação. B05/B06.'],
 ['F07 • Alto<br>Backup/restore','Aberto quanto à recuperação. Jobs de backup não comprovam restauração integral.','Restore incluindo auth, chaves, vínculos e dados; tempo/resultado documentados. B06.'],
 ['F08 • Alto<br>TLS/perímetro','Dependência externa e trabalho no app; defaults HTTP e configuração efetiva permanecem pendentes.','TLS válido, allowlist, certificados/downgrade e evidência do fornecedor. B07.'],
 ],[22,41,37])+
 note('F02 foi reaberto na revisão local apesar do fechamento declarado no V4.1. A correção implementada agora trata o vetor reproduzido; não deve ser extrapolada para todas as sessões ou rotas.')+
 p('Evidências de suporte: '+link('docs/security-remediation-2026-09-28/README.md','rodada 1')+'; '+link('scripts/security-review/regression.test.mjs','testes de guards e handlers')+'; '+link('drizzle/migrations/0063_security_company_action_scope.sql','migração 0063')+'.'))
page('04','F09–F15 e alegações contestadas','Continuidade do diagnóstico, sem promover correção parcial a encerramento',
 table(['ID / tema','Avanço / estado atual','Pendência principal'],[
 ['F09 • Alto<br>MFA administrativo','Fallback SAP preserva recusa Cloud; erro de papel bloqueia. Reset próprio proibido, contador estrito e auditoria prévia.','Validade temporal, integração Auth, matriz de rotas e cenários IdP. B04/B16.'],
 ['F10 • Alto<br>Copiloto/SQL','Ator/client de confirmação por chamada, sem globais compartilhados.','Grants SELECT/EXECUTE, leitura indireta e demais confirmações. B08/B12.'],
 ['F11 • Alto<br>Autoria/isolamento','Empresa/ação no guard; exceção Omie removida; autoria de colaboradores agora deriva de identidade.','Cobertura global de módulos/policies e homologação de grupos. B01/B12/N04.'],
 ['F12 • Médio<br>Impersonação','Consulta sem cache permissivo; erro bloqueia; fallback mantém recusa.','Todas as escritas REST/RPC/Edge/SAP e tabelas novas. B09.'],
 ['F13 • Médio<br>Logout/local','Exclusão aguardada; blocked/error observáveis; dono conferido na fila. Cinco cenários Chrome passaram.','Empresa nos snapshots, gravações tardias e requests em andamento. B10.'],
 ['F14 • Médio<br>IA/documentos','Parcial. Controles originais não cobrem todos os formatos ou conteúdo nos pixels.','Minimização, retenção, provedor e aprovações organizacionais. B11.'],
 ['F15 • Médio<br>Inventário/cron','Dois schedulers protegidos na rodada 4.2; inventário global não concluído.','Contas técnicas/demo, segredos cron, versões, dependências e recertificação. B13–B15.'],
 ],[23,42,35])+
 h('F16–F20 dos anexos V4.0')+p('As referências históricas a <code>omie-webhook</code>, bucket <code>expense-docs</code>, <code>responseHandler.ts</code>, <code>mfa-reset/reports-generator</code> e policy <code>PrestadorAccess</code> não corresponderam ao checkout examinado. Permanecem <b>não sustentadas como descritas</b>; não contam como cinco correções adicionais.')+
 p('As classes de risco continuam cobertas pelo backlog: inventário, storage, sanitização de erros, reset real de MFA e revisão de RLS/grants. Ausência no repositório não comprova ausência de objetos criados manualmente em produção.')+
 p('Detalhamento: '+link('docs/backlog-seguranca-v4.1.md','matriz histórica, interpretações e estados de execução')+'.'))
page('05','Controles implementados nas primeiras rodadas','Evidência por controle e limite de cobertura',
 table(['Controle / pontos de código','Evidência registrada','Ponderação'],[
 ['Empresa e ação<br><code>auth.ts</code>, <code>company-access.ts</code>, credenciais, CNAB, PagCorp; SQL 0063','15 testes de segurança incluem body × header, escrita negada, admin global e dispatcher CNAB; 14 verificações SQL.','Remover autorização implícita Omie pode bloquear usuários sem vínculo/grupo explícito. Revisar concessões antes de liberar.'],
 ['Documento fiscal<br><code>nf-entrada-fetch-file</code>','Anônimo barrado antes do DB; outra empresa barrada antes de assinatura; leitura permitida preservada.','Storage, gateway, provedor e download real ainda não exercitados.'],
 ['Sessões e MFA<br><code>auth.ts</code>, <code>session-revocation.ts</code>','Provas ausentes/expiradas/adulteradas; troca de empresa; revogação; erros RPC; AAL1 recusado com fallback SAP; AAL2 permitido.','Mais consultas por requisição. Medir disponibilidade e latência; falhar fechado muda comportamento em indisponibilidade.'],
 ['Confirmação de IA<br><code>copilot-chat</code>','Chamadas intercaladas mantêm donos distintos; argumento confirmado vindo do cliente não autoriza sozinho.','Não comprova limites de todas as ferramentas, SQL ou ausência de prompt injection.'],
 ['Reset MFA<br><code>mfa-admin-reset</code>','Reset próprio negado; falha de auditoria inicial impede remoção; reset por outro admin e auditoria final exercitados.','Falha de auditoria final pode ocorrer após remover fatores; API informa resultado parcial. Auth real pendente.'],
 ['Erros de handlers','Mensagem inesperada genérica em credenciais e documento fiscal.','Revisão ampla de mensagens/logs continua B17.'],
 ],[34,34,32])+
 h('Rastreabilidade')+p(link('docs/security-remediation-2026-09-28/regression-tests.txt','EV01 — saída dos 15 testes')+'<br>'+link('docs/security-remediation-2026-09-28/database-tests.json','EV02 — 14 verificações PostgreSQL')+'<br>'+link('docs/security-remediation-2026-09-28/validation.json','EV03 — manifesto e resultados da rodada 1'))+
 note('Os totais de testes não são contagem de vulnerabilidades. Há cenários sobrepostos e fronteiras simuladas. Não somar suites diferentes para anunciar cobertura percentual do sistema.'))
page('06','N01 e N02: autorização e estado fiscal','Prioridade P0 proposta • implementados; reteste de ambiente pendente',
 h('N01 — rotas privilegiadas sem autorização de negócio')+
 p('<b>Antes:</b> <code>nf-entrada-to-sap</code>, <code>audit-cross-fiscal-run</code> e <code>employees-sync-run</code> chegavam a operações com service role sem validar usuário, empresa ou ação no handler. Os ensaios capturaram criação de Draft, exclusão de resultados fiscais e registro de execução com solicitações sem identidade.')+
 p('<b>Agora:</b> <code>integration-auth</code> autentica antes da consulta e exige <code>integrate</code> na empresa obtida do recurso, nos módulos <code>nf_entrada</code>, <code>fiscal_audit</code> e <code>employee_integration</code>. Execução de NF em lote exige identidade técnica. Os callers <code>employees-sync-cron</code> e <code>audit-cross-fiscal-auto</code> também exigem identidade técnica, para não servir de contorno com credencial de serviço.')+
 p('<b>Evidência:</b> cinco entradas negam anônimo antes do banco; empresa divergente não chega a adapter/lock/escrita; fluxo permitido e schedulers autenticados continuam operando nas fixtures. A sincronização de colaboradores mantém a restrição a bases TST.')+
 note('Não foi provado acesso anônimo ao gateway publicado. Service role continua sendo uma credencial ampla: rotação e identidade técnica com menor privilégio permanecem no backlog.')+
 h('N02 — nota cancelada/rejeitada reprocessada por ID')+
 p('<b>Antes:</b> a seleção por ID ignorava o filtro de elegibilidade da seleção em lote; notas <code>cancelled</code> e <code>erpflow_rejected</code> sem Draft geravam documento e voltavam a <code>awaiting_sap</code>.')+
 p('<b>Agora:</b> o fluxo comum recusa cancelada, rejeitada no Flow/SAP e concluída. Sem Draft existente, aceita apenas <code>pending_expense</code>/<code>integration_error</code>. A reserva SQL confere o estado corrente; cancelamento/rejeição/conclusão aguardam reconciliação durante resultado incerto. A atualização do vínculo exige o status esperado, evitando sobrescrever mudança concorrente.')+
 p('<b>Aceite de ambiente:</b> negar sem efeito as transições proibidas; preservar integração elegível; testar mudança concorrente de status e reabertura explicitamente aprovada. Draft não equivale a pedido definitivo nem pagamento.')+
 p('Referências: '+link('supabase/functions/_shared/integration-auth.ts','guard compartilhado')+'; '+link('supabase/functions/nf-entrada-to-sap/index.ts','handler fiscal')+'; '+link('docs/security-v4.2-evidence/handler-tests.txt','EV06 — testes V4.2')+'.'))
page('07','N03 e N04: duplicidade e autoria','Prioridade P1 proposta • implementados; operação assistida ainda necessária',
 h('N03 — criação concorrente ou resultado incerto de Draft')+
 p('<b>Antes:</b> dois handlers liam <code>sap_po_draft_id=null</code> e criavam dois Drafts antes de persistir o vínculo. A checagem no snapshot não era uma reserva atômica.')+
 p('<b>Agora:</b> tabela <code>nf_po_draft_jobs</code> com chave exclusiva por NF e estados <code>processing → completed</code> ou <code>uncertain</code>. RLS e grants restringem o acesso de aplicação à service role. A correlação <code>ERPFlow NF &lt;id&gt;</code> permite localizar o documento antes de repetir. Resultado incerto autoriza reconciliação, <b>não outro POST</b>. A confirmação durável precede o vínculo na NF.')+
 table(['Prova local','Resultado'],[
 ['Duas reservas simultâneas no PostgreSQL','Apenas uma prossegue; a outra encontra a chave exclusiva.'],
 ['Duas reconciliações do mesmo resultado incerto','Apenas uma adquire a transição condicional.'],
 ['Timeout após gravação / falha na confirmação local','Draft localizado e reutilizado; sem segundo POST nos ensaios.'],
 ['Nenhum Draft encontrado após resultado incerto','Operação permanece bloqueada para reconciliação; não assume falha remota.'],
 ['Cancelamento durante processamento','Trigger SQL recusa a mudança até resultado conhecido.'],
 ],[52,48])+
 p('<b>Ponderação:</b> reservas não expiram automaticamente. Worker interrompido pode exigir recuperação assistida. Drafts legados não contêm a nova correlação: reconciliar antes da liberação. Não há transação distribuída ou garantia absoluta contra duplicidade externa ao fluxo.')+
 h('N04 — autoria escolhida no corpo da requisição')+
 p('<b>Antes:</b> <code>triggered_by</code> e <code>triggered_by_email</code> vinham do corpo. <b>Agora:</b> derivam da identidade verificada; usuários não escolhem autoria nem tipo scheduled. Jobs registram <code>service:integration-scheduler</code> com user_id nulo. O teste preserva execução humana/técnica e ignora os valores forjados.')+
 p('Evidência: '+link('drizzle/migrations/0064_nf_po_draft_idempotency.sql','migração 0064')+'; '+link('supabase/functions/_shared/nf-draft-once.ts','reserva/reconciliação')+'; '+link('docs/security-v4.2-evidence/database-tests.json','EV08 — PostgreSQL')+'; '+link('scripts/security-review/v42.test.mjs','EV06 — cenários de autoria e retry')+'.'))
page('08','Logout e isolamento do estado local','F13 / B10 • implementação parcial com validação em navegador',
 p('A rodada 2 tratou duas causas: a exclusão de IndexedDB era iniciada sem aguardar o resultado, e uma lista capturada pela outbox podia chegar ao sender depois da troca de conta.')+
 table(['Controle','Comportamento atual'],[
 ['Exclusão aguardada','Os dois bancos locais são excluídos por Promise. Erro ou bloqueio além de cinco segundos rejeita a limpeza. Timeout não cancela a exclusão pendente do navegador.'],
 ['Conexões abertas','Persistência de anexos fecha em versionchange. Outbox aguarda oncomplete da transação e trata erro/abort.'],
 ['Dono do item','Alteração/exclusão conferem o dono na mesma transação; flush confere identidade por item e depois da espera assíncrona.'],
 ['Troca durante o envio da fila','Se a conta mudou antes do sender, o item não é enviado e volta a pending para o dono original retomar.'],
 ['UX de logout','Callers aguardam limpeza antes do redirecionamento; falha é informada. SIGNED_OUT global registra falha, mas não desfaz uma saída já ocorrida.'],
 ],[29,71])+
 h('Cinco cenários Chrome registrados')+ul(['B não lista, altera ou exclui o item de A; o payload de A é preservado.', 'Troca durante flush não envia; A retorna e consegue concluir o envio.', 'Duas abas: a exclusão aguarda a outra conexão fechar e os bancos desaparecem.', 'Conexão mantida aberta: timeout rejeita a limpeza; fechar a aba permite concluí-la.', 'Limpeza remove estado escopado, preserva tema e permite a B usar a fila após reload.'])+
 h('Riscos que permanecem')+p('Snapshots ainda não são particionados por empresa. Faltam barreira para gravações tardias/reabertura durante limpeza, testes de troca rápida entre abas e associação/cancelamento de requests já iniciados. Concorrência de envio e idempotência financeira continuam em B19; este ensaio não comprova ausência de duplicidade.')+
 p('EV04: '+link('docs/security-remediation-2026-09-28/round2/browser-tests.json','saída Chrome com IndexedDB real')+'. '+link('docs/security-remediation-2026-09-28/round2/README.md','Método e limites')+'. Identidade e circuito ERP foram simulados; não houve login real no Auth.'))
page('09','FUNC-01: PATCH completo da despesa','Ajuste funcional separado dos achados de segurança',
 p('<b>Incidente informado:</b> despesa aprovada e integrada ao SAP, depois editada e reaprovada, chegava com valores zerados. Não foi capturada a ocorrência real no SAP; não se atribui causa exclusiva sem essa evidência.')+
 '<div class="flow">Edição validada → persistência dos itens → nova aprovação<br>→ expense-to-sap / patch_document → PATCH + releitura SAP</div>'+
 p('A implementação anterior já tentava atualizar o documento completo, mas ignorava falha de leitura das linhas, reconstruía IDs sequencialmente e não tratava a ausência de linha como erro na conferência de preço. Campos omitidos também podiam conservar estado anterior.')+
 table(['Mudança','Finalidade / limite'],[
 ['Snapshot obrigatório antes do PATCH','Falha de leitura ou coleção inválida impede payload incompleto.'],
 ['Cabeçalho e coleção completa','Campos graváveis selecionados e UDFs são preservados; dados aprovados prevalecem. Substituição da coleção por B1S-ReplaceCollectionsOnPatch.'],
 ['IDs de linha e campos explícitos','Preserva IDs com lacunas; SAP atribui IDs novos. Envia gratuito tYES/tNO e permite limpar CC/projeto quando a regra resolve valor vazio.'],
 ['Valores e conferência','UnitPrice/Price aprovados; se recalculados para zero, segundo PATCH de preço e releitura. Linha ausente ou divergência persistente impede sucesso.'],
 ['Campos protegidos','Não reenvia totais calculados, IDs do documento, filial, moeda ou datas contábeis originais; DocDueDate é atualizado.'],
 ],[31,69])+
 h('Evidência e ressalvas')+p('O teste integrado usa a montagem real do payload e o fluxo de envio. O SAP simulado zera o primeiro PATCH; a segunda correção confirma <b>2 × 506,50 = 1.013,00</b>, conservando cabeçalho, anexo, UDFs, CC, projeto e ID de linha. Seis testes adicionais cobrem o helper, falha de leitura, adição/remoção e conferência de preços.')+
 p('A associação de linhas existentes continua posicional. Campos não representados pelo formulário, remoção total de anexos e especificidades de add-ons não foram ampliados. Homologar o ciclo real completo, impostos, UDFs, linhas gratuitas e documentos encerrados.')+
 p('EV06/EV07: '+link('src/lib/sap-document-patch.test.ts','testes do PATCH')+'; '+link('supabase/functions/_shared/sap-line-merge.ts','montagem completa')+'; '+link('supabase/functions/_shared/sap-line-prices.ts','conferência de preços')+'.'))
page('10','Painel de evidências e qualidade','Resultados registrados — não reexecução dos testes na emissão deste PDF',
 table(['ID / verificação','Resultado','Alcance e limite'],[
 ['EV01 • Segurança rodada 1','15 testes passaram','Node/VM, código real com fronteiras simuladas.'],
 ['EV02 • SQL rodada 1','14 verificações passaram','PostgreSQL local, funções de 0063 em schema sintético; não replay integral.'],
 ['EV04 • Estado local','5 cenários Chrome passaram','IndexedDB real, duas abas/reload; identidade e ERP simulados.'],
 ['EV05 • Reprodução N01–N04','Comportamentos vulneráveis reproduzidos no baseline','Artefato histórico; script de reprodução não é teste de aceite do código corrigido.'],
 ['EV06 • Fluxos V4.2','12 testes passaram','Autorização, estado, concorrência simulada, autoria, retry e reaprovação.'],
 ['EV07 • Helpers PATCH','6 testes passaram','Vitest; leitura, campos, linhas, IDs e valores. Também integram a suíte geral.'],
 ['EV08 • SQL 0064','6 cenários passaram','Concorrência real de duas conexões, elegibilidade/transição, grants e RLS.'],
 ['Build frontend','Passou','Aviso de chunks grandes; não equivale a checagem das Edge Functions.'],
 ['Vitest geral','247 passaram / 49 ignorados / 1 falhou','Falha pré-existente em report-pdf.test.ts:179, expectativa #abcdef12.'],
 ['EV09 • Deno (4 rotas centrais)','25 erros antes e 25 depois','Sem novo diagnóstico por mensagem/arquivo; checagem continua reprovada.'],
 ],[31,29,40])+
 note('Não somar testes Node, Vitest, SQL e browser como uma única cobertura. Os escopos se sobrepõem; testes ignorados não são testes aprovados. Quantidade de erros igual antes/depois não prova correção de tipos.')+
 p('A comparação Deno desta rodada considera NF, colaboradores, auditoria fiscal e expense-to-sap. A rodada anterior tinha outro conjunto de seis endpoints e 54 erros após ajustes; os números não são contraditórios nem comparáveis como tendência global.')+
 p('Build e suíte geral estão registrados no documento da candidata; as saídas específicas e manifestos estão no repositório. Falta evidência correspondente ao ambiente efetivamente implantado.')+
 p('Índice completo de caminhos e integridade: páginas 14–15.'))
# Current backlog curated from execution sections, with V4.2 progress applied.
b1=[
 ['B01 • P0','Parcial','Empresa/ação em rotas críticas e N01; guard Omie/SAP.','Inventariar demais consumidores e homologar perfis. Backend/IAM.'],
 ['B02 • P0','Em reteste','Documento fiscal autenticado e autorizado antes de URL/download.','Gateway/storage/provedor e integração real. Backend/QA.'],
 ['B03 • P1','Em reteste','HMAC/expiração em toda chamada; revogação fail-closed.','Reteste implantado e carga. IAM/QA.'],
 ['B04 • P1','Parcial','Recusa MFA preservada no fallback; lookup de papel bloqueia em erro.','Sessões antigas, TTL, IdP e cobertura de rotas. IAM.'],
 ['B05 • P1','Externa','Cifra existente; rotação não comprovada.','Rotacionar/revogar, inventariar custódia. Segurança/infra.'],
 ['B06 • P1','A fazer','Recuperação integral não demonstrada.','Ensaio de restore com auth/keyring e evidência. Infra/banco.'],
 ['B07 • P1','A fazer / externa','TLS/defaults e perímetro ainda pendentes.','Remover fallback inseguro e obter prova do fornecedor. Infra/backend.'],
 ['B08 • P1','Parcial','Contexto do copiloto por chamada.','Grants SQL e todas as confirmações. IA/banco.'],
 ['B09 • P1','Parcial','Falha de lookup/fallback não libera impersonação.','Matriz REST/RPC/Edge/SAP e tabelas novas. IAM/banco.'],
 ['B10 • P2','Parcial','Limpeza aguardada e dono conferido; 5 testes browser.','Empresa nos snapshots e corridas de identidade. Frontend/QA.'],
]
page('11','Backlog consolidado • B01–B10','Estados operacionais: nenhum item declarado integralmente encerrado',
 table(['Item','Estado','Avanço','Próxima evidência / área sugerida'],b1,[14,17,32,37])+
 note('As áreas são sugestões, não responsáveis nominais designados. Prioridades preservam a ordenação de trabalho; não representam compromisso de prazo. Rotação e restauração não devem esperar a conclusão de todas as correções de código.')+
 p('A remoção de permissões implícitas exige revisar acessos legítimos antes de homologar. A solução não deve ser reabrir acesso amplo para contornar falhas de cadastro de grupos.'))
b2=[
 ['B11 • P2','A fazer','IA/documentos permanece parcial.','Formatos, dados nos pixels, retenção e aprovação do provedor. IA/privacidade.'],
 ['B12 • P1','A fazer global','Grants das novas RPC/tabela testados localmente.','RLS/EXECUTE completos por perfil e ambiente. Banco/segurança.'],
 ['B13 • P2','Parcial','N01/N04 e dois schedulers tratados.','Inventário integral, contas técnicas e credenciais restritas. Backend/infra.'],
 ['B14 • P1','Parcial','0063/0064 registradas e testadas com fixtures.','Replay integral e compatibilidade das trilhas. Banco/QA.'],
 ['B15 • P1','A fazer','Audit antigo não representa o lockfile Bun efetivo.','Auditar grafo realmente implantado. Engenharia.'],
 ['B16 • P1','Em reteste parcial','Reset próprio negado, contador e auditoria obrigatórios.','Auth real, concorrência e política de recuperação. IAM/QA.'],
 ['B17 • P2','Parcial','Erros genéricos em handlers selecionados.','Revisão de todos os retornos/logs sensíveis. Backend.'],
 ['B18 • P2','A fazer','Fronteiras de rede/arquivos não encerradas.','SSRF, storage, webhooks e browser. Segurança/backend.'],
 ['B19 • P0/P1','Parcial','N02/N03: estado fiscal, reserva e reconciliação.','CNAB/hash/autoaprovação/replay e recuperação SAP real. Financeiro/QA/backend.'],
 ['B20 • P2','Em andamento','Evidências locais, hashes e autoria N04.','Deploy, autor/revisor, alertas, retenção e recertificação. Segurança/QA.'],
]
page('12','Backlog consolidado • B11–B20','O tratamento de N01–N04 amplia o progresso, sem encerrar o escopo global',
 table(['Item','Estado','Avanço','Próxima evidência / área sugerida'],b2,[14,17,32,37])+
 h('Ordem recomendada para continuidade')+ul(['Validar 0063/0064 e permissões legítimas; retestar os vetores P0 em ambiente representativo.', 'Homologar reprocessamento fiscal e o caso real de reaprovação SAP; exercitar falhas entre ERP e banco.', 'Em paralelo, obter rotação/revogação, ensaio de restore e evidência de TLS/perímetro.', 'Completar matriz de impersonação e grants; depois ampliar browser, IA, inventário e dependências.'])+
 p('B19 foi elevado para incluir imediatamente o vetor N02. Para P0/P1, a evidência de fechamento deve acompanhar cada correção, sem aguardar um relatório final agregado.'))
page('13','Controles de liberação e riscos residuais','Condições para converter implementação local em encerramento operacional',
 table(['Etapa / controle','Evidência exigida'],[
 ['1. Preparar ambiente','Replay integral de migrações em ambiente descartável representativo. Aplicar 0063 e 0064 antes dos handlers dependentes.'],
 ['2. Revisar acessos','Matriz usuário × empresa × ação; perfis positivos/negativos; credencial técnica nos dois schedulers. Não inferir privilégios pelo nome da role.'],
 ['3. Reconciliar legado','Inventário de NFs com erro e Drafts existentes sem nova correlação. Vincular antes de permitir reenvio.'],
 ['4. Exercitar falhas','Timeout depois do POST, falha de persistência, worker interrompido, concorrência e mudança de status. Demonstrar ausência de novo POST em resultado incerto.'],
 ['5. Homologar negócios','Reaprovação SAP, anexos, UDFs, impostos, período contábil, linhas novas/removidas/gratuitas e documentos encerrados.'],
 ['6. Medir operação','Latência/carga após retirada de caches; respostas 403/423/503; trilha e alertas úteis ao suporte.'],
 ['7. Registrar aceite','Commit implantado, versões de ERP/add-ons, ambiente, data, autor/revisor, efeitos observados e testes positivos/negativos.'],
 ],[29,71])+
 h('Recuperação de reservas')+p('Se o processo morrer em processing, comprovar que não está ativo e buscar o Draft pela correlação. Operador autorizado pode mover a reserva específica para uncertain para reconciliar <b>sem novo POST</b>. Se o resultado não for conhecido, manter bloqueada. Não apagar a reserva por idade, nem tratar timeout como ausência de documento no SAP.')+
 h('Ponderações para decisão')+ul(['Falhar fechado reduz autorização indevida, mas torna indisponibilidade de dependências visível ao usuário. Medir e preparar suporte.', 'Reservas duráveis favorecem integridade frente à disponibilidade; recuperação assistida precisa de dono e trilha.', 'Testes com mocks não exercitam políticas reais, gateway, serviço de email, SAP ou add-ons; reteste implantado é indispensável.', 'Não há aceite de risco formal ou autorização para considerar TLS, rotação ou restore dispensados.'])+
 note('Este relatório não autoriza mudanças em produção, não comprova ausência de todas as vulnerabilidades e não substitui homologação ou revisão independente.'))
# Evidence index split over final two pages, preserve explicit paths and full hashes.
evidence=[
 ('EV01','docs/security-remediation-2026-09-28/regression-tests.txt','15 testes de segurança'),
 ('EV02','docs/security-remediation-2026-09-28/database-tests.json','14 verificações SQL'),
 ('EV03','docs/security-remediation-2026-09-28/validation.json','Manifesto/resultados rodada 1'),
 ('EV04','docs/security-remediation-2026-09-28/round2/browser-tests.json','5 cenários Chrome'),
 ('EV05','docs/security-additional-review-2026-09-28/reproduction-results.json','Reprodução histórica N01–N04'),
 ('EV06','docs/security-v4.2-evidence/handler-tests.txt','12 testes de handlers/fluxo'),
 ('EV07','docs/security-v4.2-evidence/patch-tests.txt','6 testes específicos PATCH'),
 ('EV08','docs/security-v4.2-evidence/database-tests.json','6 cenários PostgreSQL'),
 ('EV09','docs/security-v4.2-evidence/deno-comparison.json','Comparação Deno 25/25'),
 ('EV10','docs/security-v4.2-evidence/manifest.json','15 arquivos V4.2 e hashes'),
]
page('14','Índice de evidências e reprodução','Links apontam para os arquivos do commit de referência',
 table(['ID','Artefato do repositório','Uso'],[(id,link(path,path.removeprefix('docs/')),desc) for id,path,desc in evidence],[10,61,29])+
 h('Comandos registrados')+'<pre>node --test scripts/security-review/regression.test.mjs\nnode scripts/security-review/database-regression.mjs\nnode scripts/security-review/browser-local-state.mjs\nnode --test scripts/security-review/v42.test.mjs\nnpx vitest run src/lib/sap-document-patch.test.ts\nnode scripts/security-review/v42-database.mjs\nnpm test\nnpm run build</pre>'+
 p('Os scripts SQL têm destino fixo de loopback e fixtures sintéticas. O ensaio 0064 cria banco temporário exclusivo e o remove; não replica dados. O script de achados adicionais reproduz vulnerabilidades do baseline e não deve ser interpretado como suite de aceitação do código atual.')+
 p('As fontes autorais para contextualizar os artefatos são '+link('docs/backlog-seguranca-v4.1.md','backlog V4.1')+', '+link('docs/seguranca-v4.2.md','registro da candidata')+' e os READMEs de cada rodada. Contagens de build/Vitest geral são registros consolidados; os logs completos dessas execuções não estão anexados a este PDF.'))
verified=[]
for m in ['docs/security-v4.2-evidence/manifest.json','docs/security-remediation-2026-09-28/round2/manifest.json']:
 j=json.loads((ROOT/m).read_text());fs=j['files'];bad=[f for f,sha in fs.items() if not (ROOT/f).is_file() or hashlib.sha256((ROOT/f).read_bytes()).hexdigest()!=sha]
 if bad:raise RuntimeError('Manifest mismatch: '+str(bad))
 verified.append({'manifest':m,'checked':len(fs),'mismatches':bad})
rows=[]
for id,path,desc in evidence[-5:]:
 rows.append([id+'<br>'+e(desc),'<code class="hash">'+hashlib.sha256((ROOT/path).read_bytes()).hexdigest()+'</code>'])
page('15','Integridade, referências e controle de emissão','Correspondência documental conferida em 28/09/2026',
 p('<b>Commit atual:</b> <code>'+COMMIT+'</code>. O manifesto V4.2 foi produzido antes do commit e conserva o HEAD-base histórico. Nesta emissão, os <b>15 arquivos</b> nele listados conferem por SHA-256 com o checkout atual; os <b>9 arquivos</b> do manifesto de logout também conferem.')+
 p('Três arquivos de handlers do manifesto da revisão adicional diferem por terem sido corrigidos depois da reprodução. Isso é esperado: o manifesto antigo é prova do baseline, não do estado corrigido. Evidências históricas não foram regravadas para aparentar encerramento.')+
 table(['Artefato','SHA-256 do artefato de evidência'],rows,[34,66])+
 h('Identificação das fontes originais')+p('O backlog registra o V4.1 extraído do ZIP fornecido e o confronto com PDFs/DOCX V4.0. Os relatórios citaram um commit diferente do checkout-base; não se determinou se cada divergência era regressão ou erro de avaliação. Referências inexistentes e algoritmos de cifra divergentes foram explicitamente ponderados.')+
 '<div class="small">V4.1 original — SHA-256<br><code class="hash">191cd3725279f6bb2e484fc240268df8ec46957c5a46f63d6712a989203db1d8</code></div>'+
 h('Referência técnica externa')+p('<a href="https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html">SAP Business One Service Layer — API Reference</a>: referência consultada na implementação do contrato de PATCH. Não substitui evidência da versão SAP e dos add-ons do cliente.')+
 h('Registro de aprovação')+p('<b>Engenharia:</b> código e testes locais registrados. <b>QA/SAP:</b> homologação real pendente. <b>Segurança:</b> revisão independente não registrada. <b>Dono do risco:</b> nenhum aceite ou encerramento operacional declarado.')+
 p('O arquivo de integridade ao lado do PDF registra hash desta emissão e das fontes utilizadas. Não inclui senhas, tokens, documentos fiscais reais ou detalhes de conexão de produção.'))
CSS='''
@page { size:A4; margin:17mm 17mm 18mm; }
*{box-sizing:border-box} body{margin:0;color:#233244;font:10pt/1.42 Arial,Helvetica,sans-serif;background:white} .page{break-after:page;page-break-after:always} .page:last-child{break-after:auto;page-break-after:auto}
.eyebrow{font-size:8pt;font-weight:700;letter-spacing:1.4px;color:#537183;border-bottom:1px solid #dce5eb;padding-bottom:10px;margin-bottom:24px}.eyebrow span{float:right;color:#148077}
h1{font-size:25pt;line-height:1.15;letter-spacing:-.65px;color:#122e44;margin:0 0 10px}h2{font-size:12pt;margin:18px 0 7px;color:#154e62;break-after:avoid}p{margin:9px 0} .subtitle{font-size:10pt;color:#5f7180;margin-bottom:19px}.accent{color:#128277}.cover-rule{width:70px;height:5px;background:#128277;margin:26px 0}.cards{display:flex;gap:10px;margin:24px 0}.cards>div{flex:1;background:#eff5f7;padding:15px;font-size:9pt;line-height:1.35;border-top:3px solid #128277}.cards strong{display:block;font-size:30pt;line-height:1.1;color:#153c53;margin-bottom:9px}.cards small{display:block;color:#627482;font-size:8pt;margin-top:8px}.meta{margin-top:28px;font-size:9pt;color:#576a7a}.small{font-size:8.5pt}
aside{background:#fff6e3;border-left:3px solid #c28a2d;padding:11px 13px;margin:14px 0;font-size:9pt;break-inside:avoid}
table{border-collapse:collapse;width:100%;font-size:9pt;table-layout:fixed;margin:12px 0 16px}thead{display:table-header-group}th{background:#153c53;color:#fff;text-align:left;padding:9px;font-size:8.5pt}td{vertical-align:top;padding:9px;border-bottom:1px solid #dae4e9;overflow-wrap:anywhere}tr:nth-child(even) td{background:#f4f7f9}tr{break-inside:avoid}ul{padding-left:19px;margin:8px 0}li{margin:6px 0}a{color:#136c79;text-decoration:none;overflow-wrap:anywhere}code{font:8.3pt/1.35 Menlo,Consolas,monospace;overflow-wrap:anywhere}.hash{font-size:8pt;word-break:break-all}pre{white-space:pre-wrap;background:#f1f5f7;padding:12px;font:8.4pt/1.6 Menlo,Consolas,monospace}.flow{padding:14px;background:#edf6f4;border:1px solid #c8e3dd;color:#1e645b;font-weight:700;text-align:center;margin:15px 0}
.page:nth-child(2){font-size:9.5pt}.page:nth-child(2) td,.page:nth-child(15) td{padding:7px}.page:nth-child(15){font-size:9.5pt}
@media screen{body{background:#e9eef2}.page{width:176mm;margin:18px auto;background:white;padding:0;box-shadow:0 0 0 18px white} }
'''
OUT.mkdir(exist_ok=True)
html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ERP Flow — Cyber Assessment V4.2</title><style>'+CSS+'</style></head><body>'+''.join(pages)+'</body></html>'
(OUT/'ERP_Flow_Cyber_Assessment_V4.2.html').write_text(html)
meta={'document_version':'4.2','date':'2026-09-28','code_commit':COMMIT,'expected_pages':len(pages),'test_execution':'recorded prior results; not rerun for PDF','deployment':'not verified','verified_manifests':verified,'sources':{path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in ([path for _,path,_ in evidence] + ['docs/backlog-seguranca-v4.1.md','docs/seguranca-v4.2.md','docs/security-additional-review-2026-09-28/README.md','docs/security-remediation-2026-09-28/README.md','docs/security-remediation-2026-09-28/round2/README.md'])}}
(OUT/'ERP_Flow_Cyber_Assessment_V4.2.integrity.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'sections':len(pages),'html':str(OUT/'ERP_Flow_Cyber_Assessment_V4.2.html'),'verified':verified},ensure_ascii=False))
