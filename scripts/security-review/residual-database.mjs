// Synthetic, disposable PostgreSQL database on loopback only.
import postgres from 'postgres';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const env=Object.fromEntries((await readFile(new URL('docker/.env',root),'utf8')).split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const cfg={host:'127.0.0.1',port:54322,username:'postgres',password:env.POSTGRES_PASSWORD,max:1,connect_timeout:5,onnotice:()=>{}};
const name='erp_residual_'+Date.now();const admin=postgres({...cfg,database:'postgres'});let a,b,created=false;const passed=[];
try{
 await admin.unsafe(`CREATE DATABASE ${name}`);created=true;a=postgres({...cfg,database:name});b=postgres({...cfg,database:name});
 await a.unsafe(`CREATE TABLE accounts_payable_batches(id uuid PRIMARY KEY,company_db text,status text,generated_by text,approved_by text,approved_at timestamptz,content text,content_sha256 text,return_sha256 text,file_sequence int,bank_account_id uuid,payment_date date);
 CREATE TABLE accounts_payable_batch_items(id uuid PRIMARY KEY,batch_id uuid,company_db text,status text,sap_error text,updated_at timestamptz,sap_payment_doc_entry int);`);
 await a.unsafe(await readFile(new URL('drizzle/migrations/0066_cnab_return_safety.sql',root),'utf8'));
 const batch='11111111-1111-4111-8111-111111111111',item='22222222-2222-4222-8222-222222222222';
 await a`insert into accounts_payable_batches(id,company_db,status,generated_by,content,content_sha256) values (${batch},'A','generated','maker','synthetic',encode(sha256(convert_to('synthetic','UTF8')),'hex'))`;
 await a`insert into accounts_payable_batch_items values (${item},${batch},'A','remitted',null,now(),null)`;
 assert.equal((await a`select * from claim_accounts_payable_item(${item})`).length,0);passed.push('unapproved batch cannot reserve payment');
 await assert.rejects(()=>a`update accounts_payable_batches set approved_by=' MAKER ',approved_at=now() where id=${batch}`,e=>e.code==='23514');passed.push('self approval rejected by database');
 await assert.rejects(()=>a`update accounts_payable_batches set approved_by='checker',approved_at=now(),content='tampered' where id=${batch}`,e=>e.code==='23514');passed.push('approval atomically verifies content SHA256');
 await a`update accounts_payable_batches set approved_by='checker',approved_at=now(),status='processing' where id=${batch}`;
 const claims=await Promise.all([a,b].map(s=>s`select * from claim_accounts_payable_item(${item})`));assert.equal(claims.reduce((n,r)=>n+r.length,0),1);passed.push('concurrent claims: only one reservation');
 await a`update accounts_payable_batch_items set updated_at=now()-interval '1 day' where id=${item}`;
 assert.equal((await a`select * from claim_accounts_payable_item(${item})`).length,0);passed.push('old uncertain worker never reacquired by TTL');
 await assert.rejects(()=>a`update accounts_payable_batches set content='tampered' where id=${batch}`,e=>e.code==='23514');passed.push('approved content immutable');
 await assert.rejects(()=>a`update accounts_payable_batch_items set company_db='B' where id=${item}`,e=>e.code==='23514');
 await assert.rejects(()=>a`delete from accounts_payable_batch_items where id=${item}`,e=>e.code==='23514');passed.push('approved titles cannot change scope or be removed');
 await a`update accounts_payable_batches set return_sha256='first' where id=${batch}`;
 await assert.rejects(()=>a`update accounts_payable_batches set return_sha256='second' where id=${batch}`,e=>e.code==='23514');passed.push('another return cannot replace registered identity');
 await a`update accounts_payable_batches set status='cancelled' where id=${batch}`;
 await a`update accounts_payable_batch_items set status='remitted' where id=${item}`;
 assert.equal((await a`select * from claim_accounts_payable_item(${item})`).length,0);passed.push('cancelled batch cannot reserve payment');
 const [priv]=await a`select has_function_privilege('authenticated','claim_accounts_payable_item(uuid)','EXECUTE') as human,has_function_privilege('anon','claim_accounts_payable_item(uuid)','EXECUTE') as anon,has_function_privilege('service_role','claim_accounts_payable_item(uuid)','EXECUTE') as service`;
 assert.deepEqual(priv,{human:false,anon:false,service:true});passed.push('claim restricted to service role');
 console.log(JSON.stringify({environment:'loopback PostgreSQL; disposable synthetic database',tests:passed.map(name=>({name,passed:true}))},null,2));
}finally{await Promise.all([a?.end(),b?.end()]);if(created)await admin.unsafe(`DROP DATABASE ${name}`);await admin.end();}
