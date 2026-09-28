import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
const js=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
class AuthError extends Error {constructor(message,status=401){super(message);this.status=status;}}
const req=(body={},token='cloud')=>new Request('https://example.invalid/fn',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)});
function database(resolve){return {from(table){let op='select',value;const filters={};const q={};for(const name of ['select','update','insert','delete','upsert'])q[name]=v=>{if(name!=='select'){op=name;value=v;}return q;};q.eq=q.in=(k,v)=>{filters[k]=v;return q;};q.limit=q.gte=q.lte=()=>q;q.single=q.maybeSingle=async()=>resolve({table,op,value,filters,single:true});q.then=(a,b)=>Promise.resolve(resolve({table,op,value,filters})).then(a,b);return q;},rpc:async()=>({data:true,error:null})};}
async function fixture(bindings={}){
 let handler;const scopes=[];
 const ctx=vm.createContext({Request,Response,URL,crypto:webcrypto,AuthError,corsHeaders:{},CORS_HEADERS:{},console:{error(){},warn(){},log(){}},
 Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'service':'https://example.invalid'},serve:f=>handler=f},
 jsonResponse:(data,status=200)=>Response.json(data,{status}),authErrorResponse:e=>e instanceof AuthError?Response.json({error:e.message},{status:e.status}):null,
 requireUserOrSapSession:async r=>{if(r.headers.get('Authorization')!=='Bearer cloud')throw new AuthError('unauthorized');return {id:'11111111-1111-4111-8111-111111111111',email:'actual@example.invalid'};},
 requireAdminOrSapModule:async(r,module,scope)=>{scopes.push({module,...scope});if(scope.companyDb!=='B')throw new AuthError('forbidden',403);},...bindings});
 vm.runInContext(js(await read('supabase/functions/_shared/integration-auth.ts')),ctx);
 vm.runInContext(js(await read('supabase/functions/_shared/nf-draft-once.ts')),ctx);
 return {ctx,scopes,load:async name=>{vm.runInContext(js(await read('supabase/functions/'+name+'/index.ts')),ctx);return handler;}};
}
test('N01: anonymous cannot reach DB or ERP in three handlers and their two scheduler entrypoints',async()=>{
 for(const name of ['nf-entrada-to-sap','audit-cross-fiscal-run','employees-sync-run','audit-cross-fiscal-auto','employees-sync-cron']){
  let touched=0;const f=await fixture({createClient:()=>{touched++;throw Error('db');},admin:()=>{touched++;throw Error('db');}});
  const handler=await f.load(name);assert.equal((await handler(req({},null))).status,401,name);assert.equal(touched,0,name);
 }
});
test('Integration identity: public/fake service tokens denied; real technical key and Cloud actor supported',async()=>{
 const f=await fixture();for(const token of [null,'anon','forged'])await assert.rejects(()=>f.ctx.requireIntegrationCaller(req({},token)),e=>e.status===401);
 assert.equal((await f.ctx.requireIntegrationCaller(req({},'service'))).technical,true);
 assert.equal((await f.ctx.requireIntegrationCaller(req())).actor,'actual@example.invalid');
 assert.throws(()=>f.ctx.requireIntegrationService(req()),e=>e.status===401);
});
async function nfFixture(status='pending_expense',company='B',failCompletion=false){
 const writes=[];let drafts=0;const jobs=new Map();let row={id:'invoice',status,sap_company_db:company,sap_po_draft_id:null,chave_acesso:'fixture',cnpj_fornecedor:'123',itens:[{item_code:'X',quantidade:1,preco_unitario:10}]};
 const db=database(({table,op,value,filters,single})=>{
  if(table==='nf_po_draft_jobs'){
   const key=value?.import_id??filters.import_id;const old=jobs.get(key);
   if(op==='insert'){if(old)return {error:{code:'23505'}};jobs.set(key,{...value});return {error:null};}
   if(op==='update'){if(value.state==='completed'&&failCompletion){failCompletion=false;return {data:null,error:{message:'synthetic completion failure'}};}if(!old||Object.entries(filters).some(([k,v])=>old[k]!==v))return {data:null,error:null};Object.assign(old,value);return {data:{...old},error:null};}
   return {data:old?{...old}:null,error:null};
  }
  if(op!=='select'){writes.push({table,op,value});if(table==='nf_entrada_imports')row={...row,...value};return {data:single?{id:row.id}:null,error:null};}
  if(table==='nf_entrada_imports')return {data:single?{...row}:[{...row}],error:null};
  if(table==='system_credentials_v')return {data:Object.entries({service_layer_url:'https://sap.invalid',username:'fixture',password:'fixture'}).map(([credential_key,credential_value])=>({credential_key,credential_value})),error:null};
  throw Error('unexpected table');
 });
 const f=await fixture({createClient:()=>db,getIntegrationPause:async()=>null,getStandaloneMode:async()=>false,
 fetch:async(url,opts)=>{if(url.endsWith('/Login'))return new Response('{}',{headers:{'set-cookie':'B1SESSION=fixture;'}});if(url.includes('BusinessPartners'))return Response.json({value:[{CardCode:'fixture'}]});if(url.includes('/Drafts?'))return Response.json({value:[]});if(url.endsWith('/Drafts')){drafts++;return Response.json({DocEntry:42});}if(url.endsWith('/Logout'))return Response.json({});throw Error('unexpected URL');}});
 return {...f,handler:await f.load('nf-entrada-to-sap'),writes,getDrafts:()=>drafts,db,jobs};
}
test('N01/N02: wrong company, cancelled/rejected/completed notes and unprivileged batch cause no write',async()=>{
 for(const [status,company,expected] of [['pending_expense','OTHER',403],['cancelled','B',409],['erpflow_rejected','B',409],['sap_rejected','B',409],['completed','B',409]]){
  const f=await nfFixture(status,company);assert.equal((await f.handler(req({import_id:'invoice'}))).status,expected);assert.equal(f.getDrafts(),0);assert.equal(f.writes.length,0);
 }
 const f=await nfFixture();assert.equal((await f.handler(req())).status,403);
});
test('N01/N03: authorized NF integrates, replays reuse it, concurrent calls create one Draft',async()=>{
 const f=await nfFixture();const responses=await Promise.all([f.handler(req({import_id:'invoice'})),f.handler(req({import_id:'invoice'}))]);
 assert.equal(f.getDrafts(),1);assert.ok(responses.some(r=>r.status===200));
 assert.equal((await f.handler(req({import_id:'invoice'}))).status,200);assert.equal(f.getDrafts(),1);
 assert.equal(f.scopes[0].module,'nf_entrada');assert.equal(f.scopes[0].action,'integrate');
});
test('N03: ambiguous POST reconciles an existing Draft without issuing a second POST',async()=>{
 const f=await nfFixture();let creates=0;let remote=null;
 await assert.rejects(()=>f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;remote='77';throw Error('timeout');},async()=>null));
 assert.equal(await f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;return '88';},async()=>remote),'77');assert.equal(creates,1);
});
test('N03: uncertainty with no remote match fails closed until reconciliation finds the Draft',async()=>{
 const f=await nfFixture();let creates=0;
 await assert.rejects(()=>f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;throw Error('timeout');},async()=>null));
 await assert.rejects(()=>f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;return '88';},async()=>null),e=>e.status===409);assert.equal(creates,1);
 assert.equal(await f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;return '88';},async()=> '77'),'77');assert.equal(creates,1);
});
test('N01: fiscal audit scopes actual company before adapter or deletion; permitted flow retained',async()=>{
 for(const company of ['B','OTHER']){
  let writes=0,calls=0;const db=database(({table,op})=>{if(op!=='select'){writes++;return {error:null};}return {data:table==='companies'?{id:'company',company_db:company,erp_type:'fixture'}:table==='auditoria_cruzamento_config'?null:[],error:null};});
  const f=await fixture({createClient:()=>db,getAdapter:()=>({erp_origem:'fixture',getContasPagas:async()=>{calls++;return [];}}),DEFAULT_TOLERANCE:{janelaDias:1}});
  const handler=await f.load('audit-cross-fiscal-run');const response=await handler(req({empresa_id:'company',periodo_inicio:'2026-09-01',periodo_fim:'2026-09-28'}));
  assert.equal(response.status,company==='B'?200:403);assert.equal(calls,company==='B'?1:0);assert.equal(writes,company==='B'?1:0);
 }
});
test('N04: employees derive actor and execution type from identity; spoofed body never becomes audit author',async()=>{
 for(const token of ['cloud','service']){
  const writes=[];const db=database(({table,op,value,single})=>{if(op!=='select')writes.push({table,op,value});return {data:table==='employee_integration_config'?{id:'config',company_db:'B',is_active:true}:single?{id:'execution'}:[],error:null};});
  const f=await fixture({admin:()=>db,assertTstCompany:()=>{},loadCredentials:async()=>({api_key:'fixture'}),sapLogin:async()=>({}),sapCheckUdfs:async()=>({missing:[]}),fetchAllJumpCloudUsers:async()=>[],sapListEmployees:async()=>[],logIntegrationCall:async()=>{}});
  const handler=await f.load('employees-sync-run');const response=await handler(req({integration_config_id:'config',triggered_by_email:'forged@example.invalid',triggered_by:'forged',execution_type:'scheduled'},token));
  assert.equal(response.status,200,await response.clone().text());const record=writes.find(w=>w.table==='employee_sync_execution'&&w.op==='insert').value;
  assert.equal(record.triggered_by_email,token==='cloud'?'actual@example.invalid':'service:integration-scheduler');assert.equal(record.execution_type,token==='cloud'?'manual':'scheduled');assert.equal(record.triggered_by,token==='cloud'?'11111111-1111-4111-8111-111111111111':null);
 }
});
test('Expense reapproval: real payload builder and PATCH pipeline preserve complete approved content and repair zero SAP prices',async()=>{
 const text=await read('supabase/functions/expense-to-sap/index.ts');const patches=[];
 let saved={DocNum:99,NumAtCard:'NF 123',U_External:'preserve',DocumentLines:[{LineNum:3,ItemCode:'OLD',Quantity:1,UnitPrice:0,Price:0,WarehouseCode:'01',U_Line:'keep'}]};
 const context=vm.createContext({Response,console,expense:{id:'expense-fixture',supplier_code:'VENDOR',company_db:'B',sap_doc_num:99,remarks:'edited',currency:'BRL',cost_center:'CC',project:''},items:[{item_code:'NEW',description:'approved description',quantity:2,unit_price:506.5,cost_center:'NEW_CC',project:'',free_of_charge:false}],isPagCorp:false,isSales:false,docDate:'2026-09-01',dueDate:'2026-10-01',today:'2026-09-28',paymentGroupCode:7,branchId:1,requesterCode:'requester',attachmentEntry:10,headerCustom:{},lineCustom:{},truncateSapText:(s,n)=>String(s??'').slice(0,n),sap:{baseUrl:'https://sap.invalid',cookies:'fixture'},sapEndpoint:'PurchaseOrders',patchDocEntry:55,isPatchMode:true,expenseCode:'FIXTURE',adoptedExistingDocument:false,lastSapPayload:null,
 fetch:async(url,init)=>{
  if(init?.method==='PATCH'){
   const payload=JSON.parse(init.body);patches.push({payload,headers:init.headers});
   if(init.headers['B1S-ReplaceCollectionsOnPatch']==='true') saved={...saved,...payload,DocumentLines:payload.DocumentLines.map(l=>({...l,UnitPrice:0,Price:0,LineTotal:0}))};
   else saved.DocumentLines=saved.DocumentLines.map(l=>{const update=payload.DocumentLines.find(x=>x.LineNum===l.LineNum);return {...l,...update,LineTotal:l.Quantity*update.UnitPrice};});
   return new Response(null,{status:204});
  }
  return Response.json(saved);
 }});
 for(const path of ['supabase/functions/_shared/sap-line-merge.ts','supabase/functions/_shared/sap-line-prices.ts'])vm.runInContext(js(await read(path)),context);
 vm.runInContext(js(text.slice(text.indexOf('async function patchSapDocument('),text.indexOf('/** Só é seguro atualizar'))),context);
 vm.runInContext(js(text.slice(text.indexOf('    const sapPayload: Record'),text.indexOf('    // Consistência de tipo do documento'))),context);
 const start=text.indexOf('    const sendDocument = async');const end=text.indexOf('    let sapResult;',start);
 vm.runInContext(js(text.slice(start,end))+'\nglobalThis.send=sendDocument;',context);
 const result=await context.send();assert.equal(result.docEntry,55);assert.equal(patches.length,2);
 const full=patches[0].payload;assert.equal(full.NumAtCard,'NF 123');assert.equal(full.U_External,'preserve');assert.equal(full.AttachmentEntry,10);assert.equal(full.DocDueDate,'2026-10-01');assert.equal(full.PaymentGroupCode,7);
 assert.equal(full.DocumentLines[0].LineNum,3);assert.equal(full.DocumentLines[0].UnitPrice,506.5);assert.equal(full.DocumentLines[0].Price,506.5);assert.equal(full.DocumentLines[0].CostingCode,'NEW_CC');assert.equal(full.DocumentLines[0].ProjectCode,'');assert.equal(full.DocumentLines[0].FreeOfChargeBP,'tNO');assert.equal(full.DocumentLines[0].U_Line,'keep');assert.equal(saved.DocumentLines[0].LineTotal,1013);
});

test('N03: SAP success followed by local completion failure reconciles without duplicate creation',async()=>{
 const f=await nfFixture('pending_expense','B',true);let creates=0;
 await assert.rejects(()=>f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;return '77';},async()=>null),/confirmação local/);
 assert.equal(await f.ctx.createNfDraftOnce(f.db,'invoice',async()=>{creates++;return '88';},async()=> '77'),'77');assert.equal(creates,1);
});
test('N01: employees from another company are denied before audit/lock/ERP writes',async()=>{
 let writes=0;const db=database(({op})=>{if(op!=='select')writes++;return {data:{id:'config',company_db:'OTHER',is_active:true},error:null};});
 db.rpc=async()=>{writes++;return {data:true,error:null};};
 const f=await fixture({admin:()=>db,assertTstCompany:()=>{},logIntegrationCall:async()=>{writes++;}});
 const handler=await f.load('employees-sync-run');assert.equal((await handler(req({integration_config_id:'config'}))).status,403);assert.equal(writes,0);
});
test('Scheduler entrypoints retain authenticated technical execution',async()=>{
 for(const name of ['employees-sync-cron','audit-cross-fiscal-auto']){
  const db=database(()=>({data:[],error:null}));const f=await fixture({createClient:()=>db});const handler=await f.load(name);
  assert.equal((await handler(req({},'service'))).status,200,name);
 }
});
