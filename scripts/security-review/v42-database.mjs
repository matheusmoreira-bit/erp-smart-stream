// Destructive operations restricted to a newly created synthetic local database.
import postgres from 'postgres';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const env=Object.fromEntries((await readFile(new URL('docker/.env',root),'utf8')).trim().split('\n').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const config={host:'127.0.0.1',port:54322,username:'postgres',password:env.POSTGRES_PASSWORD,max:1,connect_timeout:5,onnotice:()=>{}};
const name='erp_v42_test_'+Date.now();
const admin=postgres({...config,database:'postgres'});let a,b,created=false;const tests=[];
try {
 await admin.unsafe(`CREATE DATABASE ${name}`);created=true;
 a=postgres({...config,database:name});b=postgres({...config,database:name});
 await a.unsafe('CREATE TABLE public.nf_entrada_imports(id uuid PRIMARY KEY, status text NOT NULL)');
 await a.unsafe(await readFile(new URL('drizzle/migrations/0064_nf_po_draft_idempotency.sql',root),'utf8'));
 const id='11111111-1111-4111-8111-111111111111';const cancelled='22222222-2222-4222-8222-222222222222';
 await a`insert into nf_entrada_imports values (${id},'pending_expense'),(${cancelled},'cancelled')`;
 const attempts=await Promise.allSettled([a,b].map(sql=>sql`insert into nf_po_draft_jobs(import_id,state,token) values (${id},'processing',gen_random_uuid())`));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length,1);tests.push('concurrent reservations: exactly one succeeds');
 await assert.rejects(()=>a`insert into nf_po_draft_jobs(import_id,state,token) values (${cancelled},'processing',gen_random_uuid())`,e=>e.code==='23514');tests.push('current cancelled status rejected by database trigger');
 await assert.rejects(()=>a`update nf_entrada_imports set status='cancelled' where id=${id}`,e=>e.code==='23514');tests.push('cancellation during remote processing is blocked until reconciliation');
 await a`update nf_po_draft_jobs set state='uncertain' where import_id=${id}`;
 const claims=await Promise.all([a,b].map(sql=>sql`update nf_po_draft_jobs set state='processing',token=gen_random_uuid() where import_id=${id} and state='uncertain' returning import_id`));
 assert.equal(claims.reduce((n,r)=>n+r.length,0),1);tests.push('concurrent reconciliation: exactly one claims uncertain result');
 const grants=await a`select has_table_privilege('authenticated','nf_po_draft_jobs','INSERT') as human, has_table_privilege('anon','nf_po_draft_jobs','SELECT') as anon, has_table_privilege('service_role','nf_po_draft_jobs','INSERT') as service`;
 assert.equal(grants[0].human,false);assert.equal(grants[0].anon,false);assert.equal(grants[0].service,true);tests.push('job table inaccessible to anonymous/authenticated; service allowed');
 const rls=await a`select relrowsecurity as enabled from pg_class where oid='nf_po_draft_jobs'::regclass`;assert.equal(rls[0].enabled,true);tests.push('RLS enabled');
 console.log(JSON.stringify({environment:'local PostgreSQL; synthetic database removed after test',tests:tests.map(name=>({name,passed:true}))},null,2));
}finally{await Promise.all([a?.end(),b?.end()]);if(created)await admin.unsafe(`DROP DATABASE ${name}`);await admin.end();}
