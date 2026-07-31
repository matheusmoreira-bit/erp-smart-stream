
## Segregação por empresa
- Chamados de cadastro são filtrados por `company_db` da empresa SAP ativa.
- Agentes (Facilities/Admin) têm o botão "Todas as empresas" para ver a fila global.
- A checagem de duplicidade (`find_open_registration_duplicate`) considera a empresa: mesmo CNPJ em empresas distintas gera chamados distintos.
