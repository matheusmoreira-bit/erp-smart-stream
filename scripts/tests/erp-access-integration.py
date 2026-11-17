import subprocess,json
from pathlib import Path
BASE=['psql','postgresql://lovable@127.0.0.1:55432/postgres?sslmode=disable','-X','-A','-t','-v','ON_ERROR_STOP=1','-c']
def sql(q):
 r=subprocess.run(BASE+[q],text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
h='d8da2168-b339-46f0-84a4-6c674e6f8f77'; d='92305a29-1893-4a9a-8ddf-e1dc98ececc2';j='f64dbcd6-bd23-47de-939d-91d386f85b77';m='28dc95ee-92b4-4c0d-8310-eba68a3ad0c8';a='8a229285-c36c-489f-ba1b-0cc03b779d7c'; b='00000000-0000-4000-8000-000000000001'
users={h:'hiller.brandao@growth.gg',d:'douglas.vinicius@anagaming.com.br',j:'juliana.gavineli@anagaming.com.br',m:'mauricio.farias@anagaming.com.br',a:'artur.angelo@anagaming.com.br',b:'synthetic.blocked@example.test'}
for uid,email in users.items():sql(f"INSERT INTO auth.users VALUES('{uid}','{email}',now()); INSERT INTO public.synthetic_documents VALUES({list(users).index(uid)+1},'{uid}',3); INSERT INTO storage.objects VALUES({list(users).index(uid)+1},'{uid}','synthetic');")
for uid in [h,d,b]:sql(f"INSERT INTO public.user_roles VALUES('{uid}','admin');")
sql("INSERT INTO public.erp_access_control(id) VALUES(true); UPDATE public.erp_access_control SET coverage_verified=true;")
def actor(uid,query,aal='aal2'):
 return sql(f"SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='{uid}'; SET request.jwt.claim.email='{users[uid]}'; SET request.jwt.claim.aal='{aal}'; "+query).splitlines()[-1]
def expect_error(uid,q,text,aal='aal2'):
 try:actor(uid,q,aal)
 except RuntimeError as e:assert text in str(e);return
 raise AssertionError('Expected denial')
assert actor(b,"SELECT public.erp_access_admitted();")=='t'
assert actor(b,'SELECT count(*) FROM public.synthetic_documents;')=='1'
actor(h,"SELECT public.manage_erp_access('enable',1,NULL);")
for uid in [h,d,j,m,a]:assert actor(uid,'SELECT public.erp_access_admitted();')=='t'
assert actor(b,'SELECT public.erp_access_admitted();')=='f'
assert actor(b,'SELECT count(*) FROM public.synthetic_documents;')=='0'
assert actor(b,'SELECT count(*) FROM storage.objects;')=='0'
assert actor(j,'SELECT count(*) FROM public.synthetic_documents;')=='1'
assert actor(j,'SELECT count(*) FROM storage.objects;')=='1'
expect_error(b,"SELECT * FROM public.get_nf_entrada_cache_by_po('TEST',1);",'temporariamente bloqueado')
expect_error(b,'SELECT * FROM public.get_system_activity(1);','temporariamente bloqueado')
expect_error(b,"SELECT public.manage_erp_access('disable',2,NULL);",'MFA')
expect_error(h,"SELECT public.manage_erp_access('disable',2,NULL);",'MFA','aal1')
expect_error(h,f"SELECT public.manage_erp_access('remove',2,'{users[d]}');",'recuperação')
expect_error(h,"SELECT public.manage_erp_access('disable',1,NULL);",'Configuração mudou')
actor(h,f"SELECT public.manage_erp_access('allow',2,'{users[b]}');")
assert actor(b,'SELECT public.erp_access_admitted();')=='t'
assert actor(b,'SELECT count(*) FROM public.synthetic_documents;')=='1'
actor(d,f"SELECT public.manage_erp_access('remove',3,'{users[b]}');")
assert actor(b,'SELECT public.erp_access_admitted();')=='f'
actor(d,"SELECT public.manage_erp_access('disable',4,NULL);")
assert actor(b,'SELECT public.erp_access_admitted();')=='t'
assert actor(b,'SELECT count(*) FROM public.synthetic_documents;')=='1'
assert actor(b,'SELECT count(*) FROM storage.objects;')=='1'
assert actor(b,"SELECT count(*) FROM public.get_nf_entrada_cache_by_po('TEST',1);")=='6'
assert actor(b,'SELECT count(*) FROM public.get_system_activity(1);')=='1'
assert sql('SELECT count(*) FROM public.audit_log;')=='4'
print('PASS: same admission migrations with synthetic data; 5 people retained; other admin/current session denied; RLS/storage/RPC denied; MFA required; managers protected; stale writes denied; individual reopen and Douglas full rollback verified; four audited actions.')
Path('/tmp/erp-access-test/result.json').write_text(json.dumps({'passed':True,'scope':'synthetic local PostgreSQL','production_enabled':False,'cases':['five_people','blocked_admin','existing_session','RLS','storage','sql_RPC','plpgsql_RPC','MFA','manager_protection','stale_write','individual_reopen','Douglas_rollback','audit']},indent=2))
