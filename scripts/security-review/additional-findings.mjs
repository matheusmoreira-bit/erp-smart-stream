// Reproduces current findings with synthetic dependencies. No network or database connections.
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const js=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
const base={Request,Response,URL,console:{error(){},log(){},warn(){}},corsHeaders:{},CORS_HEADERS:{},jsonResponse:(data,status=200)=>Response.json(data,{status})};
async function handler(path,bindings){let fn;const ctx=vm.createContext({...base,...bindings,Deno:{env:{get:()=> 'synthetic'},serve:f=>fn=f}});vm.runInContext(js(await read(path)),ctx);return fn;}
const request=body=>new Request('https://example.invalid/function',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
function dbFixture(resolve){return {from(table){let operation='select',value;const filters={};const q={};for(const method of ['select','update','insert','delete','upsert'])q[method]=v=>{if(method!=='select'){operation=method;value=v;}return q;};for(const method of ['eq','in','gte','lte'])q[method]=(k,v)=>{filters[k]=v;return q;};q.limit=()=>q;q.single=q.maybeSingle=async()=>resolve({table,operation,value,filters,single:true});q.then=(ok,fail)=>Promise.resolve(resolve({table,operation,value,filters})).then(ok,fail);return q;},rpc:async()=>({data:true,error:null})};}
const results=[];
async function fiscal(status,concurrent=false){let drafts=0;const writes=[];const fixture={id:'synthetic-invoice',status,sap_company_db:'COMPANY_B',sap_po_draft_id:null,chave_acesso:'synthetic',cnpj_fornecedor:'12345678000199',itens:[{item_code:'fixture',quantidade:1,preco_unitario:1}]};
 const db=dbFixture(({table,operation,value,filters})=>{
  if(operation!=='select'){writes.push({table,operation,value});return {data:null,error:null};}
  if(table==='nf_entrada_imports')return {data:filters.status&&filters.status!==status?[]:[{...fixture}],error:null};
  if(table==='system_credentials_v')return {data:Object.entries({service_layer_url:'https://erp.invalid',username:'fixture',password:'fixture'}).map(([credential_key,credential_value])=>({credential_key,credential_value})),error:null};
  throw Error('unexpected table '+table);
 });
 const fn=await handler('supabase/functions/nf-entrada-to-sap/index.ts',{createClient:()=>db,getIntegrationPause:async()=>null,getStandaloneMode:async()=>false,fetch:async(url)=>{if(url.endsWith('/Login'))return new Response('{}',{headers:{'set-cookie':'B1SESSION=synthetic;'}});if(url.includes('/BusinessPartners'))return Response.json({value:[{CardCode:'fixture'}]});if(url.endsWith('/Drafts'))return Response.json({DocEntry:++drafts});if(url.endsWith('/Logout'))return Response.json({});throw Error('unexpected network target');}});
 const body={import_id:fixture.id};const responses=concurrent?await Promise.all([fn(request(body)),fn(request(body))]):[await fn(request(body))];
 return {drafts,writes,statuses:responses.map(r=>r.status)};
}
const bypass=await fiscal('cancelled');assert.equal(bypass.drafts,1);assert.equal(bypass.statuses[0],200);assert.ok(bypass.writes.some(w=>w.value?.status==='awaiting_sap'));results.push({id:'N01/N02',scenario:'request without identity and invoice status cancelled reaches SAP Drafts and local update',...bypass});
const rejected=await fiscal('erpflow_rejected');assert.equal(rejected.drafts,1);results.push({id:'N02',scenario:'invoice rejected in ERP Flow also creates draft',...rejected});
const race=await fiscal('pending_expense',true);assert.equal(race.drafts,2);results.push({id:'N03',scenario:'two concurrent requests on same unprocessed invoice create two drafts',...race});
const auditWrites=[];let adapterCalls=0;
const auditDb=dbFixture(({table,operation,value})=>{if(operation!=='select'){auditWrites.push({table,operation});return {error:null};}return {data:table==='companies'?{id:'company-b',company_db:'B',erp_type:'synthetic'}:table==='auditoria_cruzamento_config'?null:[],error:null};});
const audit=await handler('supabase/functions/audit-cross-fiscal-run/index.ts',{createClient:()=>auditDb,getAdapter:()=>({erp_origem:'synthetic',getContasPagas:async()=>{adapterCalls++;return [];}}),DEFAULT_TOLERANCE:{toleranciaValorAbs:1,toleranciaValorPct:1,janelaDias:1,usarRaizCnpjFallback:false}});
const auditResponse=await audit(request({empresa_id:'company-b',periodo_inicio:'2026-09-01',periodo_fim:'2026-09-28'}));assert.equal(auditResponse.status,200);assert.equal(adapterCalls,1);assert.ok(auditWrites.some(w=>w.operation==='delete'));results.push({id:'N01',scenario:'fiscal audit without identity invokes ERP adapter and deletes prior automatic results',status:auditResponse.status,adapterCalls,writes:auditWrites});
const employeeWrites=[];
const employeeDb=dbFixture(({table,operation,value})=>{if(operation!=='select')employeeWrites.push({table,operation,value});return {data:table==='employee_integration_config'?{id:'config',company_db:'TST_FIXTURE',is_active:true}:{id:'execution'},error:null};});
const employeeShared=await read('supabase/functions/_shared/employee-sync.ts');const ctx=vm.createContext({});vm.runInContext(js(employeeShared.slice(employeeShared.indexOf('export function assertTstCompany'),employeeShared.indexOf('export function admin'))),ctx);
const employee=await handler('supabase/functions/employees-sync-run/index.ts',{admin:()=>employeeDb,assertTstCompany:ctx.assertTstCompany,loadCredentials:async()=>{throw Error('fixture stops before external integrations');},logIntegrationCall:async()=>{}});
const employeeResponse=await employee(request({integration_config_id:'config',triggered_by_email:'claimed-admin@example.invalid'}));
const record=employeeWrites.find(w=>w.table==='employee_sync_execution'&&w.operation==='insert');assert.equal(record.value.triggered_by_email,'claimed-admin@example.invalid');assert.equal(employeeResponse.status,500);results.push({id:'N01/N04',scenario:'unauthenticated request persists execution with caller-supplied actor before synthetic downstream failure',status:employeeResponse.status,record});
assert.throws(()=>ctx.assertTstCompany('PRODUCTION'));results.push({id:'control',scenario:'employee sync retains TST-only restriction',passed:true});
console.log(JSON.stringify({date:'2026-09-28',environment:'local VM, real handlers, mocked database/ERP, no remote I/O',results},null,2));
