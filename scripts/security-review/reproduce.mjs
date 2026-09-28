// Local evidence harness. Node >=24; no credentials, network or database access.
// Executes repository TypeScript after stripping types; mocks only external boundaries.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
const root = new URL('../../', import.meta.url);
async function source(path) { return readFile(new URL(path, root), 'utf8'); }
function executable(ts) {
  return stripTypeScriptTypes(ts, { mode: 'transform' })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}
const logs = [];
const report = (id, observed) => { logs.push({id, observed}); };
const env = {SUPABASE_URL:'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY:'local-service', SUPABASE_ANON_KEY:'local-anon', SAP_MIDDLEWARE_SECRET:'synthetic-test-secret'};
let clock = Date.now();
class TestDate extends Date { static now() { return clock; } }
let admin = false;
let moduleAllowed = false;
const moduleCalls = [];
const ctx = vm.createContext({
  Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
  crypto:webcrypto, atob, btoa, Date:TestDate, console:{warn(){}},
  Deno:{env:{get:k=>env[k]}}, isErpSessionRevoked:async()=>false,
  createClient:()=>({
    auth:{getClaims:async()=>({data:{claims:{sub:'test-user',email:'test@growth.gg'}},error:null})},
    rpc:async(name,args)=>{
      if(name==='has_module_action') moduleCalls.push(args);
      return {data:name==='has_role'?admin:name==='has_module_action'?moduleAllowed:false,error:null};
    }
  })
});
vm.runInContext(executable(await source('supabase/functions/_shared/auth.ts')), ctx);
const sapSession='synthetic-session-123', companyDB='TEST_DB', sapUser='test';
const b64 = x=>Buffer.from(x).toString('base64url');
const sidHash=b64(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(sapSession)));
const payload=b64(JSON.stringify({companyDB,userName:sapUser,sidHash,exp:Math.floor(clock/1000)+2}));
const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(env.SAP_MIDDLEWARE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const token=payload+'.'+b64(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)));
const headers={'x-sap-session':sapSession,'x-sap-user':sapUser,'x-company-db':companyDB,'x-sap-auth-token':token};
const req=h=>new Request('https://example.invalid/functions/v1/expense-mutation',{method:'POST',headers:h});
assert.equal(await ctx.validateSapSession(req({...headers,'x-sap-auth-token':''})),null);
assert.ok(await ctx.validateSapSession(req(headers)));
assert.ok(await ctx.validateSapSession(req({...headers,'x-sap-auth-token':''})));
report('R01','Cold cache rejects missing HMAC; warm cache accepts the same session without HMAC.');
clock+=3000;
assert.ok(await ctx.validateSapSession(req(headers)));
report('R02','Warm cache accepts HMAC after payload expiration (clock advanced 3 seconds).');
admin=true;
const jwt=b64('{}')+'.'+b64(JSON.stringify({sub:'test-user',aal:'aal1'}))+'.synthetic';
const mfaReq=req({...headers,Authorization:'Bearer '+jwt});
await assert.rejects(()=>ctx.requireUser(mfaReq),e=>e.status===403);
assert.equal((await ctx.requireUserOrSapSession(mfaReq)).source,'sap_session');
report('R03','With mocked verified admin identity at aal1, requireUser denies 403; SAP fallback accepts.');
let handler;
const nfctx=vm.createContext({Request,Response,TextEncoder,Uint8Array,AbortSignal,atob,console,
  corsHeaders:{},Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}},
  createClient:()=>({from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'fixture',xml_storage_path:'xml/fixture.xml'}})}),
    storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/synthetic-signed-url'}})})}})
});
vm.runInContext(executable(await source('supabase/functions/nf-entrada-fetch-file/index.ts')),nfctx);
const response=await handler(new Request('https://example.invalid/nf-entrada-fetch-file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({import_id:'fixture',kind:'xml'})}));
assert.equal(response.status,200);
assert.ok((await response.json()).url);
report('R04','NF handler returns a signed URL without any authentication headers for a mocked existing import. Gateway not simulated.');
admin=false; moduleAllowed=true;
vm.runInContext('adminRoleCache.clear();',ctx);
let credentialsHandler, written;
const credctx=vm.createContext({Request,Response,URL,console,corsHeaders:{},
  Deno:{env:{get:k=>env[k]},serve:fn=>{credentialsHandler=fn;}},
  AuthError:vm.runInContext('AuthError',ctx),
  requireAdminOrSapModule:ctx.requireAdminOrSapModule,
  requireAdminOrSapSessionHeaders:ctx.requireAdminOrSapSessionHeaders,
  authErrorResponse:ctx.authErrorResponse,rejectForeignOrigin:()=>null,
  createClient:()=>({from:()=>({upsert:async row=>{written=row;return {error:null};}})})
});
vm.runInContext(executable(await source('supabase/functions/credentials/index.ts')),credctx);
const cr=await credentialsHandler(new Request('https://example.invalid/functions/v1/credentials',{
  method:'POST',headers:{Authorization:'Bearer '+jwt,'x-company-db':'ALLOWED_A','Content-Type':'application/json'},
  body:JSON.stringify({company_db:'OTHER_B',system_name:'sap',credentials:[{key:'service_layer_url',value:'https://example.invalid'}]})
}));
assert.equal(cr.status,200);assert.equal(written.company_db,'OTHER_B');
assert.equal(moduleCalls.at(-1)._action,'view');assert.equal(moduleCalls.at(-1)._company_db,'ALLOWED_A');
report('R05','Real auth helper + credentials handler check view in ALLOWED_A then write OTHER_B. RPC permission result and database write mocked.');
console.log(JSON.stringify({scope:'Local isolated harness; external services mocked; not a production pentest',results:logs},null,2));
