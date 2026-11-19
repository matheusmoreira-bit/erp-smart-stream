"""Run against an isolated PostgreSQL fixture, never production."""
import json
import subprocess
import sys
from pathlib import Path

base = ['psql', sys.argv[1], '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c']

def sql(query):
    result = subprocess.run(base + [query], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip().splitlines()[-1]

users = {
    'hiller.brandao@growth.gg': 'd8da2168-b339-46f0-84a4-6c674e6f8f77',
    'hiller.brandao@cactuscorporation.com': '1783d855-cc24-40de-920d-f087e356a9c8',
    'douglas.vinicius@anagaming.com.br': '92305a29-1893-4a9a-8ddf-e1dc98ececc2',
    'mauricio.farias@anagaming.com.br': '28dc95ee-92b4-4c0d-8310-eba68a3ad0c8',
    'juliana.gavineli@anagaming.com.br': 'f64dbcd6-bd23-47de-939d-91d386f85b77',
    'artur.angelo@anagaming.com.br': '8a229285-c36c-489f-ba1b-0cc03b779d7c',
    'fernanda.faria@anagaming.com.br': '92183e7e-554f-437c-8a00-7acbbdccb715',
    'bruna.padilha@cactusgaming.net': 'f4e8e96a-e18f-435d-8a93-9aa729c7e558',
    'flavia.alves@growth.gg': '00000000-0000-4000-8000-000000000008',
    'other.admin@example.test': '00000000-0000-4000-8000-000000000009',
}
hiller = 'hiller.brandao@growth.gg'
douglas = 'douglas.vinicius@anagaming.com.br'
blocked = 'other.admin@example.test'

def actor(email, query, aal='aal2'):
    return sql(f"SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='{users[email]}'; SET request.jwt.claim.email='{email}'; SET request.jwt.claim.aal='{aal}'; " + query)

def denied(email, query, message, aal='aal2'):
    try:
        actor(email, query, aal)
    except RuntimeError as error:
        assert message in str(error), str(error)
        return
    raise AssertionError('Expected denial: ' + message)

for email, uid in users.items():
    if email == 'flavia.alves@growth.gg':
        continue
    sql(f"INSERT INTO auth.users VALUES('{uid}','{email}',now());")
for email in [hiller, douglas, blocked]:
    sql(f"INSERT INTO public.user_roles VALUES('{users[email]}','admin');")
sql('INSERT INTO public.erp_access_control(id) VALUES(true);')
subprocess.run(['psql', sys.argv[1], '-v', 'ON_ERROR_STOP=1', '-f', 'drizzle/migrations/0082_independent_web_access_restriction.sql'], check=True, capture_output=True)

# Missing Flavia cannot silently be left out during activation.
denied(hiller, "SELECT public.manage_erp_web_access('enable',1,NULL);", 'flavia.alves@growth.gg')
assert json.loads(actor(hiller, 'SELECT public.erp_web_access_status();'))['ready'] is False
sql(f"INSERT INTO auth.users VALUES('{users['flavia.alves@growth.gg']}','flavia.alves@growth.gg',now());")
actor(hiller, "SELECT public.manage_erp_web_access('allow',1,'flavia.alves@growth.gg');")
denied(blocked, "SELECT public.manage_erp_web_access('enable',2,NULL);", 'MFA')
denied(hiller, "SELECT public.manage_erp_web_access('enable',2,NULL);", 'MFA', 'aal1')
denied(hiller, "SELECT public.manage_erp_web_access('enable',1,NULL);", 'Configuração mudou')
denied(hiller, f"SELECT public.manage_erp_web_access('remove',2,'{douglas}');", 'recuperação')
actor(hiller, "SELECT public.manage_erp_web_access('enable',2,NULL);")
for email in users:
    state = json.loads(actor(email, 'SELECT public.erp_web_access_status();'))
    assert state['admitted'] == (email != blocked), email
    # Global admission and integrations retain their original behavior.
    assert actor(email, 'SELECT public.erp_access_admitted();') == 't', email
assert sql('SELECT enabled FROM public.erp_access_control;') == 'f'
actor(hiller, f"SELECT public.manage_erp_web_access('allow',3,'{blocked}');")
assert json.loads(actor(blocked, 'SELECT public.erp_web_access_status();'))['admitted'] is True
actor(douglas, f"SELECT public.manage_erp_web_access('remove',4,'{blocked}');")
assert json.loads(actor(blocked, 'SELECT public.erp_web_access_status();'))['admitted'] is False
actor(douglas, "SELECT public.manage_erp_web_access('disable',5,NULL);")
assert json.loads(actor(blocked, 'SELECT public.erp_web_access_status();'))['admitted'] is True
assert sql("SELECT count(*) FROM public.audit_log WHERE action LIKE 'erp_web_access_%';") == '5'
assert sql('SELECT enabled FROM public.erp_access_control;') == 'f'
# User-approved final list excludes Flavia; future access still uses normal allow.
sql("UPDATE public.erp_access_control SET web_required_emails=array_remove(web_required_emails,'flavia.alves@growth.gg');")
actor(hiller, "SELECT public.manage_erp_web_access('remove',6,'flavia.alves@growth.gg');")
assert json.loads(actor(hiller, 'SELECT public.erp_web_access_status();'))['ready'] is True
actor(hiller, "SELECT public.manage_erp_web_access('enable',7,NULL);")
for email in users:
    expected = email not in (blocked, 'flavia.alves@growth.gg')
    assert json.loads(actor(email, 'SELECT public.erp_web_access_status();'))['admitted'] is expected, email
assert sql('SELECT cardinality(web_allowed_user_ids) FROM public.erp_access_control;') == '8'
assert sql('SELECT enabled FROM public.erp_access_control;') == 'f'
print('PASS: seven people/eight accounts without Flavia; future allow supported; pending account; blocked admin; MFA; stale version; recovery protection; independent API admission; individual reopen; Douglas rollback; audit.')