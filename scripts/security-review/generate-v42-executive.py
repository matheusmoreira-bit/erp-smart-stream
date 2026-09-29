"""V4.1-style update with literal, traceable source excerpts in annexes."""
from pathlib import Path
from html import escape as esc
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/reports';STEM='ERP_Flow_Relatorio_Seguranca_V4.2_com_Anexos'
COMMIT=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();OLD='410a28c9081c44a2feefba450736025b61bf75c7'
BASE='https://github.com/matheusmoreira-bit/erp-smart-stream/blob/'
pages=[];sources={};snippets=[]
def p(s):return '<p>'+s+'</p>'
def h(s):return '<h2>'+s+'</h2>'
def note(s):return '<aside>'+s+'</aside>'
def table(head,rows,widths):return '<table><colgroup>'+''.join(f'<col style="width:{w}%">' for w in widths)+'</colgroup><thead><tr>'+''.join('<th>'+s+'</th>' for s in head)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+s+'</td>' for s in row)+'</tr>' for row in rows)+'</tbody></table>'
def link(path,label,rev=COMMIT):return f'<a href="{BASE}{rev}/{path}">{esc(label)}</a>'
def page(title,body,kind='Relatório'):
 pages.append(f'<section class="page"><div class="running">ERP Flow — Relatório de Segurança V4.2 · Confidencial · 28/09/2026</div><h1>{title}</h1><div class="kind">{kind}</div>{body}</section>')
def snippet(path,anchor,count,label='Código atual',old=False):
 text=subprocess.check_output(['git','show',f'{OLD}:{path}'],cwd=ROOT,text=True) if old else (ROOT/path).read_text()
 lines=text.splitlines();matches=[i for i,s in enumerate(lines) if anchor in s]
 if len(matches)!=1:raise ValueError((path,anchor,len(matches)))
 start=matches[0];part=lines[start:start+count];rev=OLD if old else COMMIT
 sources[f'{rev}:{path}']=hashlib.sha256(text.encode()).hexdigest()
 snippets.append({'path':path,'commit':rev,'first_line':start+1,'last_line':start+len(part),'sha256':hashlib.sha256('\n'.join(part).encode()).hexdigest()})
 code=''.join('<div class="codeline"><span class="ln">'+str(start+i+1)+'</span><span class="text">'+esc(line)+'</span></div>' for i,line in enumerate(part))
 return '<div class="snippet"><div class="file">'+esc(label)+' · '+link(path,f'{path} · L{start+1}–{start+len(part)}',rev)+'</div><div class="code">'+code+'</div></div>'
R1='docs/security-remediation-2026-09-28/regression-tests.txt';R4='docs/security-v4.2-evidence/handler-tests.txt'
def result(path,contains):
 text=(ROOT/path).read_text();sources[path]=hashlib.sha256(text.encode()).hexdigest();lines=[x for x in text.splitlines() if contains in x]
 if len(lines)!=1:raise ValueError((path,contains,len(lines)))
 return '<div class="test"><b>Saída registrada do teste</b><pre>'+esc(lines[0])+'</pre>'+link(path,'Abrir evidência completa')+'</div>'
def explain(proof,limit):return p('<b>O que demonstra:</b> '+proof)+p('<b>O que falta:</b> '+limit)
page('Relatório de Segurança — ERP Flow',
 '<div class="version">Versão 4.2 — atualização do V4.1, com anexos de evidências</div>'+
 table(['Referência','Informação'],[['Data-base','28/09/2026'],['Base de código','Commit <code>'+COMMIT[:12]+'</code> · ERP Flow'],['Método','Revisão de código e testes locais registrados. Sem nova consulta ao banco de produção ou ao SAP.'],['Classificação','Confidencial — Uso Interno'],['Leitura','Páginas 1–4: resumo e decisões. Anexos A–J: trechos reais do código e resultados de testes.']],[22,78])+
 h('1. Sumário executivo')+
 p('As correções avançaram nos acessos por empresa, validação de sessão, MFA, documentos fiscais e limpeza de dados ao sair do sistema. Também foram tratados <b>quatro novos achados</b>: integrações sem checagem de permissão, notas canceladas ou rejeitadas reprocessadas, criação de rascunhos duplicados e identificação do responsável informada pelo próprio solicitante.')+
 p('<b>O código foi corrigido e os cenários descritos passaram nos testes locais.</b> A confirmação no ambiente utilizado pela operação ainda está pendente. Por isso, esta atualização não repete a conclusão de que todos os riscos críticos estão encerrados.')+
 '<div class="status"><div>Correções<br><b>Testadas localmente</b></div><div>Ambiente de operação<br><b>Validação pendente</b></div><div>Rotação, backup e TLS<br><b>Pendências abertas</b></div></div>'+
 h('O que mudou para o negócio')+
 '<ul><li>O usuário precisa ter permissão para a <b>empresa e a operação</b> que está tentando executar.</li><li>Uma nota cancelada ou rejeitada não deve voltar a gerar rascunho no SAP pelo reprocessamento.</li><li>Se houver dúvida sobre o resultado no SAP, o sistema procura o documento antes de tentar criar outro.</li><li>A reaprovação de despesas recebeu ajuste para reenviar o conteúdo aprovado e conferir os valores, em seção separada de segurança.</li></ul>'+
 note('<b>Para liberar:</b> aplicar as migrações necessárias, conferir os acessos legítimos e testar os fluxos no ambiente de homologação. Rotação de senhas/chaves, restauração de backup e TLS continuam exigindo evidência própria.')+
 p('Os anexos mostram o trecho que implementa cada controle e o teste correspondente. Eles não substituem a validação no ambiente publicado. Nenhum encerramento operacional é declarado nesta emissão.'))
rows=[
 ['F01','Cadastro / domínio','Crítico','A confirmar','Validação no servidor existe. Configurações e contas do ambiente publicado precisam ser reconferidas.'],
 ['F02','Identidade da sessão SAP','Crítico','Corrigido localmente','Assinatura e validade conferidas em toda chamada, mesmo após acesso anterior. Anexo A.'],
 ['F03','Uso da conta de serviço SAP','Crítico','Cobertura a confirmar','Controle original do proxy preservado. Falta conferir outros consumidores e privilégios reais da conta.'],
 ['F04','Exceção de aprovação PagCorp','Crítico','Parcial','Texto livre não autoriza; criação exige permissão na empresa. Homologar o fluxo completo. Anexo B.'],
 ['F05','CNAB / dados bancários','Crítico','Parcial','Cada ação exige sua permissão; falta retestar dupla aprovação, integridade e repetição de retorno. Anexo B.'],
 ['F06','Segredos expostos','Crítico','Rotação pendente','Cifra existente não prova troca/revogação das credenciais anteriormente expostas.'],
 ['F07','Backup e recuperação','Alto','Restore pendente','Ainda falta demonstrar restauração completa, incluindo autenticação e chaves.'],
 ['F08','HANA / Service Layer sem TLS','Alto','Aberto / terceiros','Exigir TLS e restrição de rede; depende de infraestrutura e fornecedor.'],
 ['F09','MFA administrativo','Alto','Parcial','Recusa não escapa pelo acesso SAP; reset exige outro admin e auditoria. Anexos A/C.'],
 ['F10','Copiloto / SQL','Alto','Parcial','Confirmações isoladas por chamada; privilégios SQL e cobertura das ferramentas pendentes. Anexo C.'],
 ['F11','Autoria / isolamento','Alto','Parcial','Empresa e ação passam a ser exigidas nas rotas tratadas; autoria verificada. Anexos B/E.'],
 ['F12','Impersonação somente leitura','Médio','Parcial','Falha de consulta não libera escrita; falta matriz completa de rotas e banco. Anexo A.'],
 ['F13','Dados locais após logout','Médio','Parcial','Limpeza aguarda conclusão e fila confere o dono. Corridas e divisão por empresa pendentes. Anexo D.'],
 ['F14','IA / privacidade','Médio','Aberto / parcial','Mascaramento, formatos, retenção e aprovação do provedor continuam pendentes.'],
 ['F15','Inventário e agendamentos','Médio','Parcial','Dois agendadores protegidos; inventário global e revisão de contas ainda pendentes. Anexo E.'],
]
page('2. Situação dos achados originais (F01–F15)',
 p('A severidade é a do relatório original. <b>“Corrigido localmente” não significa “encerrado em produção”.</b> Estados atualizados com base nas correções e evidências do repositório.')+
 '<div class="matrix">'+table(['ID','Achado','Sev.','Situação atual','Atualização / evidência'],rows,[6,22,9,18,45])+'</div>'+
 p('<b>Leitura em relação ao V4.1:</b> a revisão encontrou falhas residuais em pontos antes classificados como fechados. Os controles foram ampliados; onde o teste publicado ou a cobertura ainda faltam, a situação permanece parcial.'))
page('3. Pendências e plano de conclusão',
 table(['Item','Ação necessária','Referência de prazo'],[
 ['F06','Trocar e revogar credenciais expostas; registrar responsáveis e comprovação.','30 dias no V4.1'],
 ['F07','Executar uma restauração completa e comprovar dados, autenticação e recuperação das chaves.','30 dias no V4.1'],
 ['F08','Obter TLS no HANA e restrição de acesso ao Service Layer com infraestrutura/Wevy.','Dependência externa'],
 ['F10/F11','Conferir permissões do copiloto e os grupos por empresa; completar a cobertura das rotas.','15/30 dias no V4.1'],
 ['F13','Concluir troca de conta/empresa entre abas, gravações tardias e chamadas já iniciadas.','15 dias no V4.1'],
 ['F14','Aprovar política de classificação, mascaramento e retenção dos dados enviados à IA.','60 dias no V4.1'],
 ['Extra','Revisar acesso direto a tabelas/funções, dependências efetivas e inventário de serviços.','60 dias para policies no V4.1'],
 ['N01–N04','Aplicar migrações 0063/0064 antes dos serviços dependentes; retestar acessos, estado da nota e duplicidade.','Priorizar na homologação'],
 ['FUNC-01','Repetir no SAP o ciclo: aprovar → integrar → editar → reaprovar → conferir conteúdo e valores.','Antes de liberar o ajuste'],
 ],[13,64,23])+
 p('Os prazos acima são a referência do V4.1, <b>não novos compromissos ou prazos reiniciados</b>. Responsáveis nominais e datas de aceite ainda precisam ser definidos. O backlog detalhado B01–B20 permanece no repositório.')+
 h('4. Nota de integridade dos relatórios anteriores')+
 p('As descrições F16–F20 dos anexos V4.0 não corresponderam suficientemente aos arquivos e objetos conferidos. Não são contabilizadas como cinco correções adicionais. As classes de risco continuam em revisão: arquivos, integrações externas, mensagens de erro, MFA e acesso ao banco.')+
 p('Também foram revistas interpretações: quantidade de fatores MFA não prova exigência em cada ação; backup executado não comprova restauração; tabela com proteção de acesso não limita automaticamente um serviço privilegiado. A cifra de <code>system_credentials</code> observada foi PGP/AES-256, e não a descrição genérica AES-GCM repetida nos relatórios.')+
 note('A recomendação antiga de “aceitar o risco” de TLS não equivale a aceite do responsável. Nenhuma aceitação formal de risco está anexada.'))
page('5. Novos achados e correções desta atualização',
 table(['ID','Problema encontrado','Correção e situação'],[
 ['N01<br>Alta','Serviços podiam iniciar integrações sem conferir quem chamou e em qual empresa podia operar.','Autenticação e permissão por empresa/ação nas três rotas; dois agendadores também protegidos. Testes locais passaram. Anexo E.'],
 ['N02<br>Alta','Nota cancelada ou rejeitada podia voltar ao SAP pelo reprocessamento por ID.','Estados proibidos são bloqueados e reconferidos no banco ao reservar a execução. Testes locais passaram. Anexo F.'],
 ['N03<br>Alta','Duas chamadas simultâneas podiam criar dois rascunhos para a mesma nota.','Reserva única e reconciliação do resultado incerto, sem novo envio automático. Testes locais/SQL passaram. Anexo G.'],
 ['N04<br>Média','O solicitante podia informar o email do responsável no registro da sincronização.','Responsável passa a vir da identidade verificada; a informação enviada pelo usuário não substitui a autoria. Anexo E.'],
 ],[11,42,47])+
 p('N01 e N04 compartilham uma rota; N01–N03 podem compor uma mesma sequência de falhas. Os quatro IDs representam causas distintas, não quatro ataques comprovados em produção. A sincronização de colaboradores continua limitada às bases TST.')+
 h('6. Ajuste funcional — reaprovação de despesas')+
 p('<b>Relato:</b> despesa já integrada era editada e, ao ser aprovada novamente, chegava ao SAP com valores zerados. O envio agora exige a leitura completa do documento, preserva campos editáveis e identificadores das linhas e confere os preços após a atualização.')+
 p('O teste simulou o SAP zerando o primeiro envio; a correção posterior confirmou <b>2 × 506,50 = 1.013,00</b>, mantendo os demais campos previstos. A ocorrência real e as particularidades do SAP/add-ons ainda precisam ser homologadas. Anexos H/I.')+
 h('Como ler os anexos')+
 p('Cada anexo traz <b>problema → correção → trecho literal → resultado do teste → limite</b>. Arquivo, linhas e commit permitem localizar a prova. Resultados são das execuções registradas; não foram produzidos novos testes só para gerar este PDF.')+
 note('Código e resultados não comprovam publicação. O registro de liberação deve identificar versão implantada, data, responsável e teste no ambiente utilizado pela operação.'))
# A
page('Anexo A — Sessão SAP, MFA e impersonação',
 p('<b>Problema:</b> uma validação anterior em memória podia dispensar a prova atual da sessão. Uma recusa no acesso Cloud também podia ser contornada pela alternativa SAP.')+
 snippet('supabase/functions/_shared/auth.ts','  const cached = sapSessionValidationCache.get(cacheKey);',2,'Antes — baseline V4.1',True)+
 snippet('supabase/functions/_shared/auth.ts','  if (tokenPayloadHasSub(bearer)) await requireUser(req);',10)+
 snippet('supabase/functions/_shared/auth.ts','    if (deprovision.error || typeof deprovision.data',5)+
 result(R1,'missing/expired proof is denied')+result(R1,'Cloud MFA rejection cannot fall back')+
 explain('A prova e a validade são verificadas a cada acesso. Uma identidade Cloud apresentada precisa continuar atendendo a seus controles; falha na consulta de segurança bloqueia a sessão.','Confirmar esses comportamentos no serviço publicado e medir o impacto de mais consultas de segurança. Cobertura integral de impersonação e prazo das sessões permanece pendente.'),'Evidência de correção • F02/F09/F12')
# B
page('Anexo B — Permissão na empresa e na operação',
 p('<b>Correção:</b> ter acesso de leitura não deve permitir gerar, aprovar ou integrar documentos. A empresa autorizada deve ser a do recurso que será usado.')+
 snippet('supabase/functions/accounts-payable-cnab/index.ts','  const actions = {',9)+
 snippet('supabase/functions/_shared/auth.ts','      if (scope && !companyDb)',6)+
 snippet('supabase/functions/nf-entrada-fetch-file/index.ts','    await requireAdminOrSapModule(req, "nf_entrada"',7)+
 result(R1,'CNAB dispatcher requires')+
 explain('O CNAB mapeia operações para permissões distintas. O guard consulta a empresa e a ação. Para o documento fiscal, a permissão é conferida antes de emitir o link de download.','A rotina financeira completa, grupos reais, download pelo provedor e demais consumidores exigem homologação. A migração 0063 deve preceder as funções dependentes.'),'Evidência de correção • F04/F05/F11 e documentos fiscais')
# C
page('Anexo C — Confirmações de IA e reset de MFA',
 p('<b>Correção do copiloto:</b> o responsável e o cliente de banco seguem no contexto da chamada; não ficam em variáveis globais compartilhadas entre solicitações.')+
 snippet('supabase/functions/copilot-chat/index.ts','  ctx = { ...ctx, pendingSb: sb, pendingActor: actor };',2)+
 snippet('supabase/functions/copilot-chat/index.ts','  const { pendingSb, pendingActor } = ctx;',5)+
 result(R1,'Copilot pending confirmation remains')+
 p('<b>Correção do reset:</b> o administrador não redefine seu próprio MFA por essa função, e a auditoria inicial precisa funcionar antes da remoção.')+
 snippet('supabase/functions/mfa-admin-reset/index.ts','      if (target === actor.id)',7)+
 result(R1,'MFA reset: self denied')+
 explain('Os testes preservam o dono da confirmação e impedem remover fatores quando a auditoria inicial falha. Há limite de 10 tentativas por 15 minutos por administrador, com bloqueio se o contador falhar.','Permissões SQL e demais ferramentas do copiloto continuam pendentes. No MFA, falha da auditoria final pode ocorrer após remoção; isso é informado como falha parcial e exige conferência.'),'Evidência de correção • F09/F10')
# D
page('Anexo D — Limpeza no logout e dono da fila',
 p('<b>Problema:</b> o sistema iniciava a exclusão dos bancos locais sem aguardar o resultado. A fila podia continuar com uma lista capturada antes da troca de usuário.')+
 snippet('src/lib/clear-erp-local-state.ts','export async function clearUserIndexedDbs()',13)+
 snippet('src/lib/offline-outbox.ts','        if (entry.ownerId !== await getLocalOwnerId())',9)+
 '<div class="test"><b>Resultado registrado no Chrome</b>'+table(['Cenário','Resultado'],[['Outra conta tenta listar/alterar/excluir item','Dado do dono original preservado'],['Conta muda durante o processamento','Sem envio; dono original consegue retomar'],['Outra aba mantém conexão aberta','Espera pelo fechamento ou informa timeout'],['Limpeza e recarga da página','Bancos removidos; tema mantido; fila volta a funcionar']],[64,36])+link('docs/security-remediation-2026-09-28/round2/browser-tests.json','Evidência dos 5 cenários em IndexedDB real')+'</div>'+
 explain('A exclusão só é confirmada quando termina. Antes do envio, a fila confere novamente quem está conectado.','Separação dos rascunhos por empresa, gravações tardias, troca rápida entre abas e requisições já iniciadas continuam abertas.'),'Evidência de correção • F13')
# E
page('Anexo E — Quem pode integrar e quem fica registrado',
 p('<b>Correção:</b> as rotas N01 autenticam o solicitante antes de consultar dados e depois conferem a permissão na empresa do recurso. Agendadores exigem identidade técnica, sem confiar em um nome de usuário no corpo.')+
 snippet('supabase/functions/_shared/integration-auth.ts','export async function authorizeIntegrationCompany(',6)+
 snippet('supabase/functions/employees-sync-run/index.ts','    await authorizeIntegrationCompany(req, caller, "employee_integration"',1)+
 snippet('supabase/functions/employees-sync-run/index.ts','        execution_type: executionType,',5)+
 snippet('supabase/functions/_shared/integration-auth.ts','  const user = await requireUserOrSapSession(req);',6)+
 result(R4,'N01: anonymous cannot reach DB')+result(R4,'N04: employees derive actor')+
 explain('O usuário não escolhe a identidade gravada na execução. O teste nega chamadas sem identidade antes de banco/ERP nas três rotas e nos dois agendadores.','Conferir os grupos, o agendamento real e o acesso pelo gateway. A credencial de serviço ainda é ampla; rotação e menor privilégio continuam pendentes.'),'Evidência de correção • N01/N04')
# F
page('Anexo F — Nota cancelada ou rejeitada não é reaberta',
 p('<b>Correção:</b> a regra de elegibilidade passou para o fluxo comum, incluindo solicitações por ID. O banco confere o estado atual antes de aceitar a reserva.')+
 snippet('supabase/functions/_shared/nf-draft-once.ts','export function assertNfDraftEligible(',8)+
 snippet('drizzle/migrations/0064_nf_po_draft_idempotency.sql','  SELECT status INTO current_status',6)+
 snippet('drizzle/migrations/0064_nf_po_draft_idempotency.sql','  IF NEW.status IS DISTINCT FROM OLD.status',6)+
 result(R4,'N01/N02: wrong company, cancelled')+
 explain('Cancelada, rejeitada no Flow/SAP e concluída são recusadas. Durante criação de resultado incerto, a transição de cancelamento/rejeição aguarda reconciliação para não ocultar um documento já criado no ERP.','Reabertura de uma rejeição exige processo autorizado separado. Validar as transições concorrentes com o processo real. Um rascunho SAP não é um pagamento executado.'),'Evidência de correção • N02')
# G
page('Anexo G — Uma nota não deve criar dois rascunhos',
 p('<b>Correção:</b> uma reserva única no banco impede duas criações simultâneas. Se a resposta do SAP se perder, o próximo passo é localizar o documento, não repetir o envio.')+
 snippet('drizzle/migrations/0064_nf_po_draft_idempotency.sql','CREATE TABLE public.nf_po_draft_jobs (',9)+
 snippet('supabase/functions/_shared/nf-draft-once.ts','    if (job.state === "completed"',7)+
 snippet('supabase/functions/_shared/nf-draft-once.ts','    const found = await reconcile();',4)+
 result(R4,'N03: ambiguous POST reconciles')+result(R4,'N03: SAP success followed by local completion failure')+
 explain('O ID da nota é único na reserva. Resultado concluído é reutilizado; incerto só permite reconciliação. Duas conexões reais ao PostgreSQL também foram testadas: apenas uma reservou a execução.','Processo interrompido pode exigir intervenção. Não apagar reserva por tempo decorrido. Rascunhos antigos, sem a nova correlação, precisam ser reconciliados antes da liberação.'),'Evidência de correção • N03')
# H
page('Anexo H — A reaprovação envia o documento completo',
 p('<b>Problema funcional:</b> valores zerados após editar e reaprovar uma despesa integrada. A leitura das linhas podia falhar e o código continuar com dados incompletos.')+
 snippet('supabase/functions/_shared/sap-line-merge.ts','  let current: Record<string, unknown>[] = [];',7,'Antes — falha de leitura era ignorada',True)+
 snippet('supabase/functions/_shared/sap-line-merge.ts','  const res = await fetch(`${baseUrl}/${endpoint}(${docEntry})`,',6)+
 snippet('supabase/functions/_shared/sap-line-merge.ts','  for (const key of Object.keys(current))',5)+
 snippet('supabase/functions/expense-to-sap/index.ts','      const patchPayload = await buildFullDocumentPatch(',5)+
 explain('O PATCH depende de uma leitura válida. O conteúdo aprovado prevalece, campos personalizados são preservados e a coleção completa de linhas é montada antes do envio.','“Completo” se refere aos campos editáveis: totais calculados, IDs, filial, moeda e datas contábeis originais não são reenviados. Não foi capturada a ocorrência real; não se afirma causa exclusiva sem homologação.'),'Evidência funcional • FUNC-01 • fora da contagem de segurança')
# I
page('Anexo I — Preços e linhas conferidos após o envio',
 p('<b>Correção funcional:</b> preservar IDs existentes evita confundir linhas depois de exclusões. O valor aprovado é reenviado nos campos de preço e depois conferido no SAP.')+
 snippet('supabase/functions/_shared/sap-line-merge.ts','    if (current && Number.isInteger',10)+
 snippet('supabase/functions/_shared/sap-line-prices.ts','    if (!actual) throw new Error',3)+
 result(R4,'Expense reapproval: real payload builder')+
 '<div class="test"><b>Teste reproduzível — asserção do valor aprovado</b>'+snippet('src/lib/sap-document-patch.test.ts','  expect(lines[0].Quantity*lines[0].UnitPrice).toBe(1013);',1,'Teste: 2 × 506,50 = 1.013,00')+'</div>'+
 explain('O ensaio usa o código real de montagem e envio, simula o primeiro PATCH com preço zero e confirma a correção posterior, mantendo cabeçalho, anexo, campos personalizados e linha.','Homologar impostos, unidades, add-ons, linhas gratuitas e documentos encerrados. Associação das linhas existentes permanece posicional; o teste local não comprova o comportamento de todas as bases SAP.'),'Evidência funcional • FUNC-01')
# J
page('Anexo J — Resultados, origem e limites das evidências',
 table(['Verificação','Resultado registrado'],[['Segurança — primeira rodada','15 testes passaram'],['SQL de permissões — primeira rodada','14 verificações passaram'],['Logout — navegador Chrome','5 cenários passaram'],['V4.2 — rotas, autoria e fluxo de reaprovação','12 testes passaram'],['PATCH — testes específicos','6 testes passaram'],['SQL — reserva e concorrência de notas','6 cenários passaram'],['Build da aplicação','Passou; aviso anterior de arquivos grandes'],['Suíte geral','247 passaram, 49 ignorados, 1 falha anterior no teste de PDF'],['Tipos das quatro rotas centrais','25 erros antes/depois; sem novos diagnósticos. A verificação ainda falha.']],[54,46])+
 h('Origem das evidências')+
 p('Trechos extraídos literalmente dos arquivos, com numeração de linha. <b>Código atual:</b> commit <code>'+COMMIT[:12]+'</code>. <b>Antes:</b> baseline <code>'+OLD[:12]+'</code>. Os arquivos completos estão nos links de cada anexo; os recortes e hashes ficam registrados no arquivo de integridade que acompanha este PDF.')+
 p(link(R1,'Resultados da primeira rodada')+' · '+link(R4,'Resultados V4.2')+' · '+link('docs/security-v4.2-evidence/database-tests.json','Concorrência no PostgreSQL')+' · '+link('docs/security-v4.2-evidence/manifest.json','Manifesto de arquivos V4.2'))+
 h('O que não deve ser concluído a partir dos testes')+
 p('Não somar as suites como percentual de cobertura: há cenários sobrepostos. Nenhum teste remoto foi feito para esta emissão. As provas locais não atestam configuração de produção, TLS, restauração, privilégios reais do SAP ou encerramento de todas as brechas.')+
 h('Critério para encerrar')+
 p('Registrar versão implantada, migrações aplicadas, responsável e revisor, pedido/resposta sem dados sensíveis, efeito observado e teste positivo/negativo no ambiente correspondente. A publicação desta atualização não equivale ao aceite operacional.')+
 note('Este PDF substitui a apresentação extensa da V4.2 para leitura executiva. O V4.1 permanece como histórico; alegações antigas de consulta “ao vivo” não são apresentadas como validações novas.'))
CSS='''@page{size:A4;margin:16mm 17mm 18mm}*{box-sizing:border-box}body{margin:0;color:#242b32;background:white;font:10pt/1.38 Arial,Helvetica,sans-serif}.page{break-after:page}.page:last-child{break-after:auto}.running{font-size:8pt;color:#5b6878;border-bottom:1px solid #cbd4dd;padding-bottom:8px;margin-bottom:20px}h1{color:#25466b;font-size:19pt;line-height:1.2;margin:0 0 5px}h2{font-size:12pt;color:#25466b;margin:17px 0 8px}.version{color:#5b6878;font-size:12pt;margin:8px 0 18px}.kind{font-size:9pt;color:#657384;margin-bottom:16px}p{margin:9px 0}ul{padding-left:18px}li{margin:7px 0}table{table-layout:fixed;border-collapse:collapse;width:100%;margin:12px 0;font-size:9pt}th{text-align:left;color:#25466b;background:#eef2f6;padding:8px;border-bottom:1px solid #adbcca}td{vertical-align:top;padding:8px;border-bottom:1px solid #dce2e7;overflow-wrap:anywhere}tr{break-inside:avoid}.matrix table{font-size:8.2pt;line-height:1.28}.matrix td,.matrix th{padding:6px}.status{display:flex;margin:20px 0}.status div{flex:1;text-align:center;padding:12px 7px;background:#e7f1ed;color:#245647;font-size:9pt}.status div:nth-child(2){background:#fff0cf;color:#785817}.status div:nth-child(3){background:#f7e6e4;color:#8a3b37}aside{background:#f6f1e7;border-left:3px solid #b78a3a;padding:10px 12px;font-size:9pt;margin:13px 0}a{color:#285f88;text-decoration:none;overflow-wrap:anywhere}code{font:8.5pt Menlo,Consolas,monospace;overflow-wrap:anywhere}.snippet{margin:10px 0;break-inside:avoid}.file{font-size:7.8pt;color:#44566b;padding:6px 8px;background:#e8eef4;border:1px solid #d4dfe8;border-bottom:0;overflow-wrap:anywhere}.code{border:1px solid #d4dfe8;padding:8px 5px;background:#f8fafc}.codeline{display:flex;font:7.6pt/1.4 Menlo,Consolas,monospace}.ln{flex:none;width:31px;color:#8895a3;text-align:right;padding-right:9px;user-select:none}.text{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0;flex:1}.test{padding:8px 10px;background:#eff6f2;border-left:3px solid #588776;font-size:8.5pt;margin:10px 0;break-inside:avoid}.test pre{white-space:pre-wrap;overflow-wrap:anywhere;font:8pt/1.4 Menlo,Consolas,monospace;margin:6px 0}.test .snippet{margin-bottom:0}.test td,.test th{padding:6px}.page:nth-child(n+5){font-size:9.5pt}.page:nth-child(n+5) h1{font-size:17pt}
@media screen{body{background:#e9eef2}.page{width:176mm;background:white;margin:20px auto;box-shadow:0 0 0 18px white}}
'''
OUT.mkdir(exist_ok=True);(OUT/(STEM+'.html')).write_text('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ERP Flow — Relatório de Segurança V4.2 com Anexos</title><style>'+CSS+'</style></head><body>'+''.join(pages)+'</body></html>')
original=Path('/tmp/erp-security-review/ERP_Flow_Relatorio_Seguranca_V4.1.pdf')
metadata={'version':'4.2','edition':'Atualização do V4.1, com anexos de evidências','date':'2026-09-28','code_commit':COMMIT,'baseline_commit':OLD,'expected_pages':len(pages),'sources':sources,'snippets':snippets,'original_v41_sha256':hashlib.sha256(original.read_bytes()).hexdigest() if original.exists() else '191cd3725279f6bb2e484fc240268df8ec46957c5a46f63d6712a989203db1d8','tests':'previous recorded results, not rerun for this document','deployment':'not verified'}
(OUT/(STEM+'.integrity.json')).write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'pages':len(pages),'literal_excerpts':len(snippets),'output':STEM}))
