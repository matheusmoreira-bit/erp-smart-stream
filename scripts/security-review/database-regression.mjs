// Explicitly local, synthetic fixtures in a separate database; rolls all fixtures back.
import postgres from 'postgres';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const env=Object.fromEntries((await readFile(new URL('docker/.env',root),'utf8')).trim().split('\n').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const config={host:'127.0.0.1',port:54322,username:'postgres',password:env.POSTGRES_PASSWORD,max:1,connect_timeout:5,onnotice:()=>{}};
const admin=postgres({...config,database:'postgres'});
try{const db=await admin`select 1 from pg_database where datname='erp_security_regression'`;if(!db.length)await admin.unsafe('CREATE DATABASE erp_security_regression');}finally{await admin.end();}
const sql=postgres({...config,database:'erp_security_regression'});
let checks=0;
const expect=(actual,expected)=>{assert.equal(actual,expected);checks++;};
const rollback=Symbol('rollback');
try{
 await sql.begin(async tx=>{
  await tx.unsafe(`
   CREATE SCHEMA auth;
   CREATE TABLE auth.users(id uuid primary key,email text);
   CREATE TABLE user_roles(user_id uuid,role text);
   CREATE TABLE companies(company_db text primary key,erp_type text);
   CREATE TABLE user_company_access(email text,company_db text);
   CREATE TABLE user_group_assignments(sap_email text,company_db text,group_id int);
   CREATE TABLE permission_group_modules(group_id int,module_key text,can_view bool,can_create bool,can_edit bool,can_delete bool,can_approve bool,can_integrate bool,can_export bool);
   CREATE TABLE sap_user_emails(user_key text,email text);
   CREATE TABLE user_licenses(user_code text,company_db text);
   CREATE TABLE sap_group_mapping(company_db text,module_key text,sap_group_code text,can_view bool,can_create bool,can_edit bool,can_delete bool,can_approve bool,can_integrate bool,can_export bool);
   CREATE TABLE sap_cache(company_db text,data jsonb);
   CREATE FUNCTION has_role(_user_id uuid,_role text) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role)$$;
   INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111','reader@growth.gg');
   INSERT INTO companies VALUES ('A','sap'),('B','omie');
   INSERT INTO user_company_access VALUES ('reader@growth.gg','A');
   INSERT INTO user_group_assignments VALUES ('reader@growth.gg','A',1);
   INSERT INTO permission_group_modules VALUES (1,'credentials',true,false,false,false,false,false,false);
  `);
  const canonical=await readFile(new URL('supabase/migrations/20260730213712_011527cb-91e1-4122-aaba-2db087a2f3af.sql',root),'utf8');
  await tx.unsafe(canonical.slice(canonical.indexOf('CREATE OR REPLACE FUNCTION public.canonical_user_key'),canonical.indexOf('-- 2. Directory tables')));
  await tx.unsafe(await readFile(new URL('drizzle/migrations/0063_security_company_action_scope.sql',root),'utf8'));
  const uid='11111111-1111-4111-8111-111111111111';
  const can=async(company,action)=>(await tx`select has_module_action(${uid}::uuid,${company},'credentials',${action}) as ok`)[0].ok;
  expect(await can('A','view'),true);expect(await can('A','edit'),false);expect(await can('B','view'),false);
  expect((await tx`select user_can_access_company('reader@growth.gg','B') as ok`)[0].ok,false);
  await tx`insert into user_company_access values ('reader@growth.gg','B')`;
  expect(await can('B','view'),false); // Linked company alone does not import A's group.
  await tx`insert into user_group_assignments values ('reader@growth.gg','B',2)`;
  await tx`insert into permission_group_modules values (2,'credentials',true,false,true,false,false,false,false)`;
  expect(await can('B','edit'),true);expect(await can('B','approve'),false);
  const sap=async(company,action)=>(await tx`select sap_user_has_module_action('reader',${company},'credentials',${action}) as ok`)[0].ok;
  expect(await sap('A','view'),true);expect(await sap('A','edit'),false);expect(await sap('B','edit'),true);
  await tx`insert into sap_group_mapping values ('B','credentials','G',true,false,true,false,false,false,false)`;
  expect(await sap('B','edit'),false); // Configured ERP mapping must also match.
  await tx`insert into sap_cache values ('B',${tx.json({UserCode:'reader',Groups:['G']})})`;
  expect(await sap('B','edit'),true);
  expect((await tx`select has_function_privilege('authenticated','public.sap_user_has_module_action(text,text,text,text)','EXECUTE') as ok`)[0].ok,false);
  expect((await tx`select has_function_privilege('service_role','public.sap_user_has_module_action(text,text,text,text)','EXECUTE') as ok`)[0].ok,true);
  throw rollback;
 }).catch(e=>{if(e!==rollback)throw e;});
 console.log(JSON.stringify({database:'local/erp_security_regression',checks,result:'passed',fixtures:'rolled back'},null,2));
}finally{await sql.end();}
