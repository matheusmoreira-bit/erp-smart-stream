// Node 24+. Runs repository handlers with external boundaries mocked; no network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const root=new URL('../../',import.meta.url);
const source=async p=>readFile(new URL(p,root),'utf8');
function js(ts){return stripTypeScriptTypes(ts,{mode:'transform'}).replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/^export\s+/gm,'');}
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'svc',SAP_MIDDLEWARE_SECRET:'synthetic-secret'};
const base={Request,Response,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,atob,btoa,console:{warn(){},error(){},log(){}}};
const b64=x=>Buffer.from(x).toString('base64url');
const jwt=aal=>b64('{}')+'.'+b64(JSON.stringify({sub:'test-user',aal,session_id:'11111111-1111-4111-8111-111111111111'}))+'.synthetic';
const req=(headers={},body={},fn='expense-mutation')=>new Request('https://example.invalid/functions/v1/'+fn,{method:'POST',headers,body:JSON.stringify(body)});
async function authFixture(){
 const state={admin:false,impersonating:false,roleError:false,impError:false,revoked:false,revError:false,deprovisioned:false,depError:false,allow:false,calls:[],now:Date.now(),sessionAge:0,sessionError:false,sessionMissing:false};
 class Clock extends Date{static now(){return state.now;}}
 const ctx=vm.createContext({...base,Date:Clock,Deno:{env:{get:k=>env[k]}},
  isErpSessionRevoked:async()=>{if(state.revError)throw Error('offline');return state.revoked;},
  createClient:()=>({auth:{getClaims:async()=>({data:{claims:{sub:'test-user',email:'user@growth.gg'}},error:null})},
   rpc:async(name,args)=>{state.calls.push({name,args});return {
    data:name==='session_started_at'?(state.sessionMissing?null:new Date(state.now-state.sessionAge).toISOString()):name==='has_role'?state.admin:name==='is_impersonating'?state.impersonating:name==='is_erp_user_deprovisioned'?state.deprovisioned:name==='has_module_action'?state.allow:false,
    error:(name==='session_started_at'&&state.sessionError)||(name==='has_role'&&state.roleError)||(name==='is_impersonating'&&state.impError)||(name==='is_erp_user_deprovisioned'&&state.depError)?{message:'offline'}:null};}})
 });
 vm.runInContext(js(await source('supabase/functions/_shared/auth.ts')),ctx);
 const headers={'x-sap-session':'synthetic-session-123','x-sap-user':'sap-user','x-company-db':'A'};
 const sidHash=b64(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(headers['x-sap-session'])));
 const p=b64(JSON.stringify({companyDB:'A',userName:'sap-user',sidHash,exp:Math.floor(state.now/1000)+2}));
 const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(env.SAP_MIDDLEWARE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 headers['x-sap-auth-token']=p+'.'+b64(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(p)));
 return {ctx,state,headers};
}
test('SAP: valid proof works, missing/expired proof is denied after a successful call',async()=>{
 const {ctx,state,headers}=await authFixture();assert.ok(await ctx.validateSapSession(req(headers)));
 assert.equal(await ctx.validateSapSession(req({...headers,'x-sap-auth-token':''})),null);
 state.now+=3000;assert.equal(await ctx.validateSapSession(req(headers)),null);
});
test('SAP: changed user/company and invalid signature are rejected',async()=>{
 const {ctx,headers}=await authFixture();
 for(const changes of [{'x-sap-user':'other'},{'x-company-db':'B'},{'x-sap-auth-token':headers['x-sap-auth-token'].slice(0,-3)+'xxx'}])assert.equal(await ctx.validateSapSession(req({...headers,...changes})),null);
});
test('Cloud MFA rejection cannot fall back to SAP; authorized AAL2 still works',async()=>{
 const {ctx,state,headers}=await authFixture();state.admin=true;
 await assert.rejects(()=>ctx.requireUserOrSapSession(req({...headers,Authorization:'Bearer '+jwt('aal1')})),e=>e.status===403);
 assert.equal((await ctx.requireUserOrSapSession(req({...headers,Authorization:'Bearer '+jwt('aal2')}))).id,'test-user');
});
test('Impersonation rejection cannot fall back to SAP',async()=>{
 const {ctx,state,headers}=await authFixture();state.impersonating=true;
 await assert.rejects(()=>ctx.requireUserOrSapSession(req({...headers,Authorization:'Bearer '+jwt('aal2')})),e=>e.status===423);
});
test('Security RPC errors fail closed instead of reusing an earlier permission',async()=>{
 for(const flag of ['roleError','impError']){
  const {ctx,state}=await authFixture();await ctx.requireUser(req({Authorization:'Bearer '+jwt('aal1')}));state[flag]=true;
  await assert.rejects(()=>ctx.requireUser(req({Authorization:'Bearer '+jwt('aal1')})),e=>e.status===503);
 }
 for(const flag of ['revError','depError']){
  const {ctx,state,headers}=await authFixture();await ctx.validateSapSession(req(headers));state[flag]=true;
  await assert.rejects(()=>ctx.validateSapSession(req(headers)),e=>e.status===503);
 }
});
test('Revoked or deprovisioned SAP sessions are denied immediately after success',async()=>{
 for(const flag of ['revoked','deprovisioned']){const {ctx,state,headers}=await authFixture();await ctx.validateSapSession(req(headers));state[flag]=true;assert.equal(await ctx.validateSapSession(req(headers)),null);}
});
async function credentialFixture(){
 const {ctx,state}=await authFixture();let handler;const writes=[];
 const c=vm.createContext({...base,Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},
  AuthError:vm.runInContext('AuthError',ctx),requireAdminOrSapModule:ctx.requireAdminOrSapModule,
  requireAdminOrSapSessionHeaders:ctx.requireAdminOrSapSessionHeaders,authErrorResponse:ctx.authErrorResponse,rejectForeignOrigin:()=>null,
  createClient:()=>({from:()=>({upsert:async row=>{writes.push(row);return {error:null};}})})});
 vm.runInContext(js(await source('supabase/functions/credentials/index.ts')),c);
 return {state,writes,handler};
}
test('Credential write authorizes edit against the body company, never view against header',async()=>{
 const {state,writes,handler}=await credentialFixture();state.allow=true;
 const r=await handler(req({Authorization:'Bearer '+jwt('aal1'),'x-company-db':'A'},{company_db:'B',system_name:'sap',credentials:[{key:'base_url',value:'local'}]},'credentials'));
 assert.equal(r.status,200);assert.equal(writes[0].company_db,'B');
 const call=state.calls.find(c=>c.name==='has_module_action');assert.equal(call.args._company_db,'B');assert.equal(call.args._action,'edit');
});
test('Unauthorized credential write and non-admin global write have no side effects',async()=>{
 for(const company of ['B',null]){
  const {writes,handler}=await credentialFixture();const r=await handler(req({Authorization:'Bearer '+jwt('aal1'),'x-company-db':'A'},{company_db:company,system_name:'sap',credentials:[{key:'base_url',value:'local'}]},'credentials'));
  assert.equal(r.status,403);assert.equal(writes.length,0);
 }
});
test('Admin with MFA retains global credential management',async()=>{
 const {state,writes,handler}=await credentialFixture();state.admin=true;
 const r=await handler(req({Authorization:'Bearer '+jwt('aal2')},{system_name:'sap',credentials:[{key:'base_url',value:'local'}]},'credentials'));
 assert.equal(r.status,200);assert.equal(writes[0].company_db,null);
});
test('Fiscal document: reject anonymous before DB, cross-company before signing; authorized reads work',async()=>{
 for(const mode of ['anonymous','foreign','allowed']){
  const {ctx,state}=await authFixture();state.allow=mode==='allowed';let handler,reads=0,signs=0;
  const c=vm.createContext({...base,corsHeaders:{},Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},
   requireUserOrSapSession:ctx.requireUserOrSapSession,requireAdminOrSapModule:ctx.requireAdminOrSapModule,authErrorResponse:ctx.authErrorResponse,
   createClient:()=>({from:()=>({select(){reads++;return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'fixture',sap_company_db:'B',xml_storage_path:'fixture.xml'}})}),storage:{from:()=>({createSignedUrl:async()=>{signs++;return {data:{signedUrl:'https://example.invalid/file'}};}})}})});
  vm.runInContext(js(await source('supabase/functions/nf-entrada-fetch-file/index.ts')),c);
  const r=await handler(req(mode==='anonymous'?{}:{Authorization:'Bearer '+jwt('aal1'),'x-company-db':'A'},{import_id:'fixture',kind:'xml'},'nf-entrada-fetch-file'));
  assert.equal(r.status,mode==='anonymous'?401:mode==='foreign'?403:200);assert.equal(signs,mode==='allowed'?1:0);if(mode==='anonymous')assert.equal(reads,0);
  if(mode==='allowed')assert.equal(state.calls.find(x=>x.name==='has_module_action').args._company_db,'B');
 }
});
test('Copilot pending confirmation remains owned by its request during interleaving',async()=>{
 const text=await source('supabase/functions/copilot-chat/index.ts');const chunk=text.slice(text.indexOf('type ToolCtx ='),text.indexOf('async function resolveCompanyDb'));
 const c=vm.createContext({...base});vm.runInContext(js(chunk),c);const saved=[];
 const client=()=>({from:()=>({insert(row){saved.push(row);return {select(){return {single:async()=>({data:{id:row.user_id}})};}};}})});
 const a={pendingActor:{userId:'A'},pendingSb:client(),confirmed:false};const b={pendingActor:{userId:'B'},pendingSb:client(),confirmed:false};
 await Promise.all([c.requireConfirmation(a,'send_notification',{confirmed:true},'A'),c.requireConfirmation(b,'send_notification',{},'B')]);
 assert.deepEqual(saved.map(x=>x.user_id),['A','B']);assert.equal('confirmed' in saved[0].args,false);
 assert.ok(!text.includes('let pendingActor'));
});
test('MFA reset: self denied, audit failure blocks deletion, successful reset is audited',async()=>{
 for(const mode of ['self','audit_start_error','audit_end_error','allowed']){
  let handler,deletes=0;const events=[];const actor='11111111-1111-4111-8111-111111111111';const other='22222222-2222-4222-8222-222222222222';
  const c=vm.createContext({...base,Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},AuthError:class extends Error{},requireAdmin:async()=>({id:actor,email:'admin@example.invalid'}),rejectForeignOrigin:()=>null,enforceRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>new Response(null,{status:429}),
   createClient:()=>({rpc:async(name,args)=>{events.push(args.p_action);return {error:mode==='audit_start_error'||(mode==='audit_end_error'&&args.p_action==='mfa_factor_reset')?{}:null};},auth:{admin:{mfa:{listFactors:async()=>({data:{factors:[{id:'factor'}]}}),deleteFactor:async()=>{deletes++;return {};}}}}})});
  vm.runInContext(js(await source('supabase/functions/mfa-admin-reset/index.ts')),c);
  const r=await handler(req({}, {action:'reset',user_id:mode==='self'?actor:other},'mfa-admin-reset'));
  assert.equal(r.status,mode==='self'?403:mode==='allowed'?200:503);assert.equal(deletes,mode==='self'||mode==='audit_start_error'?0:1);
  if(mode==='allowed')assert.deepEqual(events,['mfa_factor_reset_requested','mfa_factor_reset']);
 }
});
test('Strict rate limiter denies missing/error counters while preserving legacy callers',async()=>{
 const c=vm.createContext({...base});vm.runInContext(js(await source('supabase/functions/_shared/rate-limit.ts')),c);
 const db={rpc:async()=>({error:{message:'offline'}})};
 const strict=await c.enforceRateLimit(db,{scope:'test',identifier:'a',max:1,windowSeconds:60,failClosed:true});assert.equal(strict.allowed,false);assert.equal(c.rateLimitResponse(strict,{}).status,503);
 assert.equal((await c.enforceRateLimit(db,{scope:'test',identifier:'a',max:1,windowSeconds:60})).allowed,true);
});
test('CNAB dispatcher requires the matching action on the body company for every operation',async()=>{
 const text=await source('supabase/functions/accounts-payable-cnab/index.ts');
 const actions={get_config:'view',get_supplier_payment_profile:'view',list_open:'view',list_batches:'view',preview_return:'view',save_config:'edit',save_supplier_payment_profile:'edit',generate:'create',approve_batch:'approve',approve_supplier_payment_profile:'approve',download_batch:'export',process_return:'integrate'};
 for(const [action,permission] of Object.entries(actions)){
  for(const allowed of [false,true]){
   let handler,effects=0;const calls=[];
   const methods=Object.fromEntries(['loadBankConfig','saveBankConfig','getSupplierPaymentProfile','saveSupplierPaymentProfile','listAvailableTitles','generateBatch','listBatches','approveBatch','approveSupplierPaymentProfile','downloadBatch','previewReturn','processReturn'].map(name=>[name,async()=>{effects++;return {};} ]));
   const c=vm.createContext({...base,...methods,corsHeaders:{},Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},createClient:()=>({}),message:String,json:(value,status=200)=>Response.json(value,{status}),authErrorResponse:()=>new Response(null,{status:403}),requireAdminOrSapModule:async(r,m,scope)=>{calls.push({m,...scope});if(!allowed)throw Error('denied');return {email:'fixture',companyDB:'B'};}});
   vm.runInContext(js(text.slice(text.indexOf('Deno.serve('))),c);
   const result=await handler(req({'x-company-db':'A'},{company_db:'B',action},'accounts-payable-cnab'));
   assert.equal(result.status,allowed?200:403);assert.equal(effects,allowed?1:0);
   assert.equal(calls[0].companyDb,'B');assert.equal(calls[0].action,permission);
   assert.equal((await handler(req({},null))).status,400);
  }
 }
});
test('Revocation helper does not cache negative results and denies malformed lookup responses',async()=>{
 let data=false;const c=vm.createContext({...base,sha256Hex:async()=> 'fixture-hash'});
 vm.runInContext(js(await source('supabase/functions/_shared/session-revocation.ts')),c);
 const db={rpc:async()=>({data,error:null})};
 assert.equal(await c.isErpSessionRevoked(db,'session'),false);
 data=null;await assert.rejects(()=>c.isErpSessionRevoked(db,'session'));
 data=true;assert.equal(await c.isErpSessionRevoked(db,'session'),true);
});

test('F09: absolute session age, revoked session and lookup failure block access; recent sessions work',async()=>{
 for(const admin of [false,true]){
  const {ctx,state}=await authFixture();state.admin=admin;
  const request=req({Authorization:'Bearer '+jwt(admin?'aal2':'aal1')});
  await ctx.requireUser(request);
  state.sessionAge=(admin?12:30*24)*3600000;
  await assert.rejects(()=>ctx.requireUser(request),e=>e.status===401);
  state.sessionAge=0;state.sessionMissing=true;
  await assert.rejects(()=>ctx.requireUser(request),e=>e.status===401);
  state.sessionMissing=false;state.sessionError=true;
  await assert.rejects(()=>ctx.requireUser(request),e=>e.status===503);
 }
});
test('F12: credential GET allowed, POST/DELETE and profile sync denied during impersonation',async()=>{
 const {ctx,state}=await authFixture();state.impersonating=true;
 const headers={Authorization:'Bearer '+jwt('aal1')};
 await ctx.requireUser(new Request('https://app.invalid/functions/v1/sap-user-credentials',{headers}));
 for(const fn of ['sap-user-credentials','sap-user-profile-sync','expense-sap-reconcile']){
  await assert.rejects(()=>ctx.requireUser(req(headers,{},fn)),e=>e.status===423);
 }
});
