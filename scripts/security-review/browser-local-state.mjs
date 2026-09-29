// Isolated Chrome + real IndexedDB; no app login or external requests.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:`
export * from './src/lib/clear-erp-local-state';
export * from './src/lib/offline-outbox';
export * from './src/lib/expense-queue-persist';
export * from './src/lib/ai-file-cache';
export * from './src/lib/ai-response-cache-persist';
`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'localTest',plugins:[{name:'offline-boundaries',setup(b){
 b.onResolve({filter:/^@\/lib\/local-owner$/},()=>({path:'owner',namespace:'fixture'}));
 b.onResolve({filter:/^@\/lib\/sap-circuit-breaker$/},()=>({path:'circuit',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='owner'?`export async function getLocalOwnerId(){return window.readOwner?window.readOwner():window.owner??null}`:`export function getCircuitState(){return {state:'closed'}};export class SapCircuitOpenError extends Error {}`}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
 const context=await browser.newContext();await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 const page=await context.newPage();await page.goto(origin);
 async function check(name,fn){await fn();results.push({name,status:'passed'});}
 await check('owner isolation: list/update/delete preserve another user’s queued item',async()=>{
  const result=await page.evaluate(async()=>{
   window.owner='A';const entry=await localTest.enqueueOutbox({kind:'expense',companyDB:'CO_A',docType:'expense',summary:{supplier_name:'fixture',total:1,itemCount:1,attachmentCount:0},payload:{fixture:true}});
   window.owner='B';const hidden=await localTest.listOutbox();await localTest.updateOutbox(entry.id,{payload:{changed:true}});await localTest.removeOutbox(entry.id);
   window.owner='A';const kept=await localTest.listOutbox();window.entryId=entry.id;
   return {hidden:hidden.length,kept:kept.length,payload:kept[0].payload};
  });assert.deepEqual(result,{hidden:0,kept:1,payload:{fixture:true}});
 });
 await check('identity changes during flush: no send; original owner can resume',async()=>{
  const result=await page.evaluate(async()=>{
   let reads=0,sent=0;window.readOwner=()=>++reads<=2?'A':'B';
   const unregister=localTest.registerOutboxSender('expense',async()=>{sent++;});
   const denied=await localTest.flushOutbox({force:true});delete window.readOwner;window.owner='A';
   const sentBefore=sent;const allowed=await localTest.flushOutbox({force:true});unregister();
   return {sentBefore,denied,allowed,sent,remaining:(await localTest.listOutbox()).length};
  });assert.equal(result.sentBefore,0);assert.equal(result.denied.skipped,1);assert.equal(result.allowed.sent,1);assert.equal(result.sent,1);assert.equal(result.remaining,0);
 });
 await check('cleanup waits for a blocked connection; other tab releases on versionchange',async()=>{
  const other=await context.newPage();await other.goto(origin);
  await other.evaluate(async()=>{window.held=await new Promise((resolve,reject)=>{const r=indexedDB.open('createExpenseModalQueue',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});window.held.onversionchange=()=>{setTimeout(()=>window.held.close(),150);};});
  const result=await page.evaluate(async()=>{const start=performance.now();await localTest.clearUserIndexedDbs();return {elapsed:performance.now()-start,dbs:(await indexedDB.databases()).map(x=>x.name)};});
  assert.ok(result.elapsed>=100);assert.ok(!result.dbs.includes('erpflow-offline'));assert.ok(!result.dbs.includes('createExpenseModalQueue'));await other.close();
 });
 await check('blocked deletion reports failure instead of successful cleanup',async()=>{
  const other=await context.newPage();await other.goto(origin);await other.evaluate(async()=>{window.held=await new Promise(resolve=>{const r=indexedDB.open('erpflow-offline');r.onsuccess=()=>resolve(r.result);});});
  const error=await page.evaluate(async()=>{try{await localTest.clearUserIndexedDbs();return null;}catch(e){return e.message;}});assert.match(error,/Feche as outras abas/);
  await other.close();await page.evaluate(()=>localTest.clearUserIndexedDbs());
 });
 await check('logout removes scoped storage, keeps theme, queue still works after reload',async()=>{
  await page.evaluate(async()=>{localStorage.setItem('theme','dark');localStorage.setItem('expenses.fixture','private');sessionStorage.setItem('erp_session_v1','fixture');await localTest.clearErpLocalState();});
  await page.reload();const result=await page.evaluate(async()=>{window.owner='B';await localTest.saveQueueState('expenses',{queueHistory:[],deferredGroups:[],failedGroups:[],cancelledGroups:[],savedAt:1},'COMPANY');return {theme:localStorage.getItem('theme'),private:localStorage.getItem('expenses.fixture'),session:sessionStorage.length,owner:(await localTest.loadQueueState('expenses','COMPANY')).ownerId};});
  assert.deepEqual(result,{theme:'dark',private:null,session:0,owner:'B'});
 });
 await check('snapshots partition by company; legacy unscoped snapshots are not restored',async()=>{
  const r=await page.evaluate(async()=>{
   window.owner='A';const state={queueHistory:['private-A'],deferredGroups:[],failedGroups:[],cancelledGroups:[],savedAt:Date.now()};
   await localTest.saveQueueState('expenses',state,'CO_A');
   const wrong=await localTest.loadQueueState('expenses','CO_B');
   const right=await localTest.loadQueueState('expenses','CO_A');
   window.owner='B';const foreign=await localTest.loadQueueState('expenses','CO_A');
   return {wrong,right:right.queueHistory,foreign};
  });assert.deepEqual(r,{wrong:null,right:['private-A'],foreign:null});
 });
 await check('logout invalidates pending snapshot and late AI result, including another tab',async()=>{
  const other=await context.newPage();await other.goto(origin);
  await page.evaluate(()=>{
   window.owner='A';window.releaseOwner=null;window.readOwner=()=>new Promise(r=>window.releaseOwner=r);
   window.pendingSave=localTest.saveQueueState('expenses',{queueHistory:['late'],deferredGroups:[],failedGroups:[],cancelledGroups:[],savedAt:1},'CO_A');
  });
  await other.evaluate(()=>localTest.clearErpLocalState());
  const r=await page.evaluate(async()=>{window.releaseOwner('A');await window.pendingSave;delete window.readOwner;return localTest.loadQueueState('expenses','CO_A');});assert.equal(r,null);
  await page.evaluate(()=>{window.pendingAi=localTest.withAiCache('fixture',()=>new Promise(r=>window.releaseAi=r)).then(()=>false,()=>true);});
  await page.waitForFunction(()=>typeof window.releaseAi==='function');
  await other.evaluate(()=>localTest.clearErpLocalState());
  assert.equal(await page.evaluate(async()=>{window.releaseAi({private:'A'});return window.pendingAi;}),true);
  await other.close();
 });
 await check('AI session cache preserves reuse but never serves another owner',async()=>{
  const r=await page.evaluate(async()=>{window.owner='A';let n=0;const make=()=>Promise.resolve(++n);const a=await localTest.withAiCache('same',make);const again=await localTest.withAiCache('same',make);window.owner='B';const b=await localTest.withAiCache('same',make);return {a,again,b};});assert.deepEqual(r,{a:1,again:1,b:2});
 });
 await check('persistent AI cache isolates owner/company and rejects work from before logout',async()=>{
  const r=await page.evaluate(async()=>{
   window.owner='A';await localTest.saveAiResponseCacheEntries('expenses',[{hash:'fixture',data:'A'}],'CO_A');
   const same=(await localTest.loadAiResponseCache('expenses','CO_A')).get('fixture');
   const company=(await localTest.loadAiResponseCache('expenses','CO_B')).size;
   window.owner='B';const owner=(await localTest.loadAiResponseCache('expenses','CO_A')).size;
   window.owner='A';window.readOwner=()=>new Promise(r=>window.releasePersistentOwner=r);
   const saving=localTest.saveAiResponseCacheEntries('expenses',[{hash:'late',data:'private'}],'CO_A');
   await localTest.clearErpLocalState();window.releasePersistentOwner('A');await saving;delete window.readOwner;
   return {same,company,owner,late:(await localTest.loadAiResponseCache('expenses','CO_A')).size};
  });assert.deepEqual(r,{same:'A',company:0,owner:0,late:0});
 });
 console.log(JSON.stringify({browser:await browser.version(),environment:'isolated loopback, real IndexedDB, mocked identity and ERP circuit',tests:results},null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));}
