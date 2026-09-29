// Local source execution, with network/DB boundaries simulated. No remote calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const root=new URL('../../',import.meta.url);
const source=p=>readFile(new URL(p,root),'utf8');
const js=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');
const base={URL,URLSearchParams,Request,Response,TextEncoder,AbortController,AbortSignal,crypto:webcrypto,console,setTimeout,clearTimeout};
async function transport(fetch){
 const c=vm.createContext({...base,fetch});
 vm.runInContext(js(await source('supabase/functions/_shared/secure-transport.ts')),c);
 vm.runInContext(js(await source('supabase/functions/_shared/sap-fetch.ts')),c);return c;
}
test('F08: HTTP and URL credentials rejected before network; HTTPS read works without redirects',async()=>{
 let calls=0;const c=await transport(async(u,o)=>{calls++;assert.equal(o.redirect,'error');return new Response('{}');});
 for(const url of ['http://erp.invalid/x','https://user:password@erp.invalid/x'])await assert.rejects(()=>c.sapFetch(url));
 assert.equal(calls,0);assert.equal((await c.sapFetch('https://erp.invalid/b1s/v2/Items?$top=1')).status,200);assert.equal(calls,1);
});
test('F05: transport never retries POST/PATCH even on timeout or HTTP 503; reads can retry',async()=>{
 for(const method of ['POST','PATCH','DELETE'])for(const fails of ['network','503']){
  let calls=0;const c=await transport(async()=>{calls++;if(fails==='network')throw Error('timeout');return new Response('',{status:503});});
  await c.sapFetch('https://erp.invalid/x',{method,maxAttempts:4,baseDelayMs:0}).catch(()=>{});assert.equal(calls,1);
 }
 let calls=0;const c=await transport(async()=>new Response('',{status:++calls===1?503:200}));
 assert.equal((await c.sapFetch('https://erp.invalid/x',{baseDelayMs:0})).status,200);assert.equal(calls,2);
 const ctrl=new AbortController();ctrl.abort();await assert.rejects(()=>c.sapFetch('https://erp.invalid/x',{signal:ctrl.signal}));assert.equal(calls,2);
});
test('F08: HANA sends credentials only to the configured HTTPS endpoint and never falls back',async()=>{
 let calls=[];const c=await transport(async(url,opts)=>{calls.push({url,opts});return new Response('',{status:503});});
 c.Deno={env:{get:()=>null}};c.generateDynamicToken=async()=> 'synthetic';
 vm.runInContext(js(await source('supabase/functions/_shared/hana-views.ts')).replace(/^export \{.*\};?$/gm,''),c);
 for(const hanaApiUrl of [undefined,'http://erp.invalid'])await assert.rejects(()=>c.fetchHanaView({schema:'A',view:'V',sessionId:'synthetic',hanaApiUrl}));
 assert.equal(calls.length,0);
 await assert.rejects(()=>c.fetchHanaView({schema:'A',view:'V',sessionId:'synthetic',hanaApiUrl:'https://erp.invalid'}));
 assert.equal(calls.length,1);assert.equal(calls[0].opts.redirect,'error');assert.match(calls[0].url,/^https:\/\/erp.invalid\//);
});
async function cnab({zeroApproval=false,postFails=false,persistFails=false,foreign=false,cancelled=false,amount=10}={}){
 const state={posts:0,writes:[],batch:{id:'batch-A',file_sequence:1,company_db:'A',status:cancelled?'cancelled':'approved',generated_by:'maker',approved_by:'checker',approved_at:'2026-09-28',content:'approved document',content_sha256:'',return_sha256:null,accounts_payable_bank_accounts:{sap_transfer_account:'synthetic'}},item:{id:'item-A',batch_id:foreign?'batch-B':'batch-A',company_db:'A',company_reference:'ref',sap_doc_entry:1,status:'remitted',amount:10}};
 const db={from(table){let changes=null,filters=[],select=false;
  const q={select(){select=true;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},or(){return q;},update(v){changes=v;return q;},upsert(v){state.writes.push({table,v});return q;},maybeSingle(){return run(true);},single(){return run(true);},then(a,b){return run(false).then(a,b);}};
  async function run(single){let rows=table==='accounts_payable_batches'?[state.batch]:table==='accounts_payable_batch_items'?[state.item]:[];rows=rows.filter(r=>filters.every(f=>f(r)));
   if(changes){state.writes.push({table,changes});if(zeroApproval&&changes.status==='approved')rows=[];
    if(persistFails&&changes.status==='sap_settled')return {data:null,error:{message:'synthetic persistence failure'}};
    rows.forEach(r=>Object.assign(r,changes));}
   return {data:single?(rows[0]||null):rows,error:null};}
  return q;
 },async rpc(name){if(name==='claim_accounts_payable_item'){
   if(state.item.status==='sap_processing'||state.item.sap_payment_doc_entry)return {data:[],error:null};
   state.item.status='sap_processing';return {data:[state.item],error:null};}
   return {data:null,error:null};}};
 const c=vm.createContext({...base,Deno:{serve(){},env:{get(){}}},baseCorsHeaders:{}});
 vm.runInContext(js(await source('supabase/functions/accounts-payable-cnab/index.ts')),c);
 c.parseSicoobReturn=()=>({fileSequence:1,titles:[{companyReference:'ref',status:'paid',paymentAmount:amount,lineNumber:1}]});
 c.loadBankConfig=async()=>({tax_id:'12345678901234',account_number:'123'});
 c.withSap=async(a,b,r,fn)=>fn('https://erp.invalid','synthetic');
 c.getInvoice=async()=>({DocEntry:1,DocNum:1,CardCode:'supplier',DocTotal:10,PaidToDate:0,DocumentStatus:'bost_Open'});
 c.postVendorPayment=async()=>{state.posts++;if(postFails)throw Error('timeout after commit');return {DocEntry:99};};
 let header=Array(240).fill(' ');header.splice(18,14,...'12345678901234');header.splice(58,12,...'000000000123');
 state.batch.content_sha256=await c.sha256(state.batch.content);
 const run=()=>c.processReturn(db,'A',header.join(''),'fixture.ret','operator',new Request('https://app.invalid'));
 return {c,db,state,run};
}
test('F05: approval rejects self, missing content, altered hash and lost CAS; independent approval works',async()=>{
 for(const mode of ['self','missing','hash','race','allowed']){
  const {c,db,state}=await cnab({zeroApproval:mode==='race'});state.batch.status='generated';state.batch.approved_by=null;
  if(mode==='missing')state.batch.content='';if(mode==='hash')state.batch.content='changed';
  const run=()=>c.approveBatch(db,'A',{batch_id:'batch-A'},mode==='self'?' MAKER ':'checker');
  if(mode==='allowed')assert.equal((await run()).status,'approved');else await assert.rejects(run);
 }
});
test('F05: cancelled batch, cross-batch reference and divergent paid amount cause no payment',async()=>{
 for(const opts of [{cancelled:true},{foreign:true},{amount:11}]){
  const {state,run}=await cnab(opts);await assert.rejects(run);assert.equal(state.posts,0);assert.equal(state.writes.length,0);
 }
});
test('F05: successful return is replay-safe; ambiguous POST and local persist failure stay reserved',async()=>{
 for(const opts of [{},{postFails:true},{persistFails:true}]){
  const {state,run}=await cnab(opts);await run();assert.equal(state.posts,1);
  if(opts.postFails||opts.persistFails)assert.equal(state.item.status,'sap_processing');else assert.equal(state.item.status,'sap_settled');
  await run();assert.equal(state.posts,1);
 }
});
test('F11/F15: health probe denies anonymous before DB; admin and scheduler reach the authorized boundary',async()=>{
 for(const mode of ['anonymous','admin','service']){
  let handler,reads=0;
  const c=vm.createContext({...base,corsHeaders:{},Deno:{serve:f=>handler=f,env:{get:()=>null}},withEdgeMetrics:(n,f)=>f,
   requireIntegrationService:()=>{if(mode!=='service')throw Error('denied');},requireAdmin:async()=>{if(mode!=='admin')throw Error('denied');},
   authErrorResponse:()=>new Response('',{status:401}),createClient:()=>({from:()=>{reads++;throw Error('authorized DB boundary');}})});
  vm.runInContext(js(await source('supabase/functions/hana-health-probe/index.ts')),c);
  const run=()=>handler(new Request('https://app.invalid',{method:'POST',body:'{}'}));
  if(mode==='anonymous'){assert.equal((await run()).status,401);assert.equal(reads,0);}
  else {await assert.rejects(run,/authorized DB boundary/);assert.equal(reads,1);}
 }
});
test('F11: reconciliation denies anonymous, cross-company and unprivileged global requests before ERP',async()=>{
 for(const mode of ['anonymous','foreign','global','allowed','service']){
  let handler,queries=0,allowed=0;
  const c=vm.createContext({...base,Deno:{serve:f=>handler=f,env:{get:()=>''}},corsFor:()=>({}),rejectForeignOrigin:()=>null,
   requireIntegrationCaller:async()=>{if(mode==='anonymous')throw Error('denied');return {technical:mode==='service',actor:'verified'};},
   authorizeIntegrationCompany:async(req,caller,module,company)=>{assert.equal(module,'fiscal_audit');assert.equal(company,'A');if(mode==='foreign')throw Error('denied');allowed++;},
   requireAdmin:async()=>{throw Error('denied');},authErrorResponse:e=>e.message==='denied'?new Response('',{status:403}):null,
   createClient:()=>({from:()=>{queries++;const q={select:()=>q,not:()=>q,order:()=>q,limit:()=>q,eq:()=>q,gte:()=>q,then:r=>Promise.resolve({data:[],error:null}).then(r)};return q;}})});
  vm.runInContext(js(await source('supabase/functions/expense-sap-reconcile/index.ts')),c);
  const res=await handler(new Request('https://app.invalid',{method:'POST',body:JSON.stringify({company_db:mode==='global'?'all':'A'})}));
  if(['anonymous','foreign','global'].includes(mode)){assert.equal(res.status,403);assert.equal(queries,0);}
  else {assert.equal(res.status,200);assert.equal(queries,1);assert.equal(allowed,1);}
 }
});
