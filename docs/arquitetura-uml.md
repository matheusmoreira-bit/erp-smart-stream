# ERP Flow - Arquitetura, UML e Jornadas

> Documento arquitetural do estado observado no repositorio em 31/08/2026.
> Os diagramas usam Mermaid para permanecerem versionaveis junto ao codigo.

## 1. Escopo e leitura

O ERP Flow e uma plataforma web multiempresa que coordena processos financeiros
e administrativos entre usuarios, regras internas e ERPs externos. A aplicacao
nao substitui o ERP contabil: ela organiza solicitacoes, aprovacoes, documentos,
auditoria e integracoes, mantendo o ERP da empresa como destino ou fonte
operacional.

Esta documentacao cobre:

- arquitetura externa: usuarios, IdPs, ERPs e demais provedores;
- arquitetura interna: frontend, Edge Functions, banco, storage, filas e jobs;
- limites de confianca, autenticacao e autorizacao;
- dominios e regras de negocio;
- fluxos de dados e estados dos documentos;
- jornadas de usuarios e agentes de sistema.

### Convencoes

| Marcador | Significado |
|---|---|
| `company_db` | Tenant logico e empresa selecionada |
| ERP | SAP Business One, Omie ou outro adapter habilitado |
| Edge Function | Backend serverless Deno/Supabase |
| Service role | Identidade tecnica privilegiada, somente no backend |
| RLS | Row Level Security do PostgreSQL |
| Watcher | Processo periodico idempotente de sincronizacao |

## 2. Visao de contexto - arquitetura externa

```mermaid
flowchart LR
    subgraph People[Perfis humanos]
        REQ[Solicitante]
        APR[Aprovador]
        OPS[Compras / Financeiro / Fiscal]
        SALES[Vendas]
        AUD[Auditor]
        ADM[Administrador]
    end

    ERPFlow[ERP Flow]

    subgraph Identity[Identidade]
        GOOGLE[Google OAuth]
        JC[JumpCloud]
        OKTA[Okta]
    end

    subgraph ERPs[Sistemas de gestao]
        SAP[SAP Business One\nService Layer + HANA]
        OMIE[Omie API]
        OTHER[Outros ERPs\nvia adapters]
    end

    subgraph Business[Provedores de negocio]
        PAG[PagCorp]
        MT[MasterTax / NFS-e]
        CNPJ[CNPJ.ws]
        SYN[Synapse]
        BCB[BCB / PTAX]
    end

    subgraph Comms[Comunicacao e suporte]
        MAIL[SMTP / e-mail]
        WA[WhatsApp Gateway]
        GDRIVE[Google Drive]
        AI[Gateway de IA / OpenAI]
    end

    REQ --> ERPFlow
    APR --> ERPFlow
    OPS --> ERPFlow
    SALES --> ERPFlow
    AUD --> ERPFlow
    ADM --> ERPFlow

    ERPFlow <--> GOOGLE
    ERPFlow <--> JC
    ERPFlow <--> OKTA
    ERPFlow <--> SAP
    ERPFlow <--> OMIE
    ERPFlow <--> OTHER
    ERPFlow <--> PAG
    ERPFlow <--> MT
    ERPFlow --> CNPJ
    ERPFlow <--> SYN
    ERPFlow --> BCB
    ERPFlow --> MAIL
    ERPFlow --> WA
    ERPFlow --> GDRIVE
    ERPFlow <--> AI
```

## 3. Visao de implantacao

```mermaid
flowchart TB
    subgraph Device[Dispositivo do usuario]
        BROWSER[Browser]
        SPA[React 18 + Vite SPA]
        CACHE[React Query + cache local]
        BROWSER --> SPA --> CACHE
    end

    subgraph Cloud[Lovable Cloud / Supabase]
        GATE[Auth e API Gateway]
        EDGE[Edge Functions Deno]
        POSTGREST[PostgREST / RPC]
        REALTIME[Realtime]
        STORAGE[Object Storage]
        DB[(PostgreSQL\nRLS + triggers)]
        JOBS[pg_cron + pg_net + filas]

        GATE --> EDGE
        GATE --> POSTGREST
        POSTGREST --> DB
        REALTIME --> DB
        EDGE --> DB
        EDGE --> STORAGE
        JOBS --> EDGE
    end

    subgraph PrivateERP[Zona ERP / integrações]
        SL[SAP Service Layer]
        HANA[HanaAPI / views]
        OMIEAPI[Omie]
    end

    subgraph SaaS[Servicos externos]
        IDP[Google / JumpCloud / Okta]
        CARDS[PagCorp]
        FISCAL[MasterTax / NFS-e]
        NOTIFY[E-mail / WhatsApp]
        AIP[IA]
        BACKUP[Google Drive / S3]
    end

    SPA -->|HTTPS + token| GATE
    SPA -->|consultas autorizadas| POSTGREST
    REALTIME -->|eventos permitidos| SPA
    EDGE -->|sessao ERP| SL
    EDGE -->|DynamicToken| HANA
    EDGE -->|app key / secret| OMIEAPI
    EDGE <--> IDP
    EDGE <--> CARDS
    EDGE <--> FISCAL
    EDGE --> NOTIFY
    EDGE <--> AIP
    EDGE --> BACKUP
```

### Limites de confianca

1. O browser e nao confiavel: controles visuais nao substituem validacao no backend.
2. Edge Functions formam a fronteira transacional e validam identidade, tenant,
   permissao, idempotencia e estado antes de usar `service_role`.
3. RLS protege acessos diretos via PostgREST; integracoes privilegiadas passam
   pelo backend.
4. Credenciais de ERP e provedores ficam em `system_credentials` ou secrets do
   runtime, nunca no payload devolvido ao frontend.
5. Toda chamada a ERP deve carregar o contexto da empresa e usar locks,
   idempotencia e log de integracao.

## 4. Arquitetura interna por componentes

```mermaid
flowchart LR
    subgraph Presentation[Camada de apresentacao]
        ROUTER[React Router]
        PAGES[Paginas e hubs]
        UI[Componentes UI]
        HOOKS[Hooks de dominio]
        CTX[Auth, ERP e permissoes]
        ROUTER --> PAGES --> UI
        PAGES --> HOOKS
        PAGES --> CTX
    end

    subgraph ClientServices[Servicos cliente]
        AUTHFETCH[auth-fetch / SAP function fetch]
        ERPCLIENT[sap-client / omie-client]
        QUERY[React Query]
        PERMGATE[ModuleRoute + gateSync]
        CTX --> PERMGATE
        HOOKS --> QUERY
        HOOKS --> AUTHFETCH
        HOOKS --> ERPCLIENT
    end

    subgraph Backend[Backend serverless]
        AUTHZ[_shared/auth + API keys]
        MUT[Gateways de mutacao]
        DOMAIN[Servicos de dominio]
        ADAPTERS[ERP adapters]
        WORKERS[Watchers / workers]
        OBS[Logs, metricas e auditoria]

        MUT --> AUTHZ
        DOMAIN --> AUTHZ
        MUT --> DOMAIN
        DOMAIN --> ADAPTERS
        WORKERS --> DOMAIN
        DOMAIN --> OBS
    end

    subgraph Persistence[Persistencia]
        CORE[(Dados transacionais)]
        CONFIG[(Configuracao / IAM)]
        CACHEERP[(Caches ERP)]
        AUDIT[(Auditoria / integracao)]
        FILES[(Storage)]
    end

    AUTHFETCH --> MUT
    ERPCLIENT --> DOMAIN
    QUERY --> CORE
    PERMGATE --> CONFIG
    DOMAIN --> CORE
    DOMAIN --> CONFIG
    DOMAIN --> CACHEERP
    OBS --> AUDIT
    DOMAIN --> FILES
```

### Modulos funcionais

| Contexto | Responsabilidade | Backend principal | Dados centrais |
|---|---|---|---|
| Compras e despesas | Rascunho, itens, anexos, aprovacao e envio ao ERP | `expense-*` | `expenses`, `expense_items`, `expense_attachments` |
| Aprovacoes | Regras, niveis, segmentos, substitutos e decisoes | `approvals-feed`, `expense-approval-action` | `approval_rules`, `expense_approval_segments`, logs |
| Vendas | Pedidos, NFS-e, adiantamentos e recebimentos | `sales-*`, `baixa-recebimento` | `pedidos_venda_erp`, `sales_order_invoices`, `baixas_recebimento` |
| PagCorp | Transacoes, prestacoes, IA, lancamento e baixa | `pagcorp-*` | mapeamentos, logs, relacoes e cache de IA |
| Fiscal | NF de entrada, arquivos, matching e fila ERP | `mastertax-*`, `nf-entrada-*` | `nf_entrada_imports`, logs e contas a pagar |
| Auditoria | Cruzamentos, divergencias, KYP e trilhas | `audit-*`, `kyp-orchestrator` | `audit_console_*`, `audit_pay_*` |
| IAM | Perfis, grupos, IdP, licencas e revisao de acesso | `admin-users`, `idp-*`, `okta-*`, `jumpcloud-*` | usuarios, grupos, mappings e roles |
| Integracoes | Credenciais, monitor, retry, health e kill-switch | workers e proxies | `system_credentials`, `integration_log`, `integration_pause` |
| Cadastros | Fornecedores, itens e replicacao intercompany | `fornecedor-save`, `item-save`, `intercompany` | `fornecedores`, `item_base`, `item_variante` |

## 5. Autenticacao e autorizacao

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant SPA as React SPA
    participant IDP as Google / IdP
    participant AUTH as Cloud Auth
    participant PERM as Grupos e permissoes
    participant EF as Edge Function
    participant RLS as PostgreSQL / RLS
    participant ERP as ERP selecionado

    U->>SPA: Abre o ERP Flow
    SPA->>AUTH: Consulta sessao web
    alt Sem sessao valida
        AUTH->>IDP: OAuth / federacao
        IDP-->>AUTH: Identidade autenticada
        AUTH-->>SPA: Sessao e token
    end
    SPA->>U: Selecionar empresa
    U->>SPA: Escolhe company_db
    SPA->>ERP: Abre ou solicita sessao gerenciada
    ERP-->>SPA: Contexto ERP da empresa
    SPA->>PERM: Carrega grupo, modulos e escopo
    PERM-->>SPA: Snapshot de permissoes
    SPA->>EF: Acao + token + company_db
    EF->>AUTH: Valida usuario, admin, API key ou sessao ERP
    EF->>PERM: Confirma permissao e tenant
    EF->>RLS: Le ou grava com identidade adequada
    RLS-->>EF: Resultado autorizado
    EF-->>SPA: Resposta sanitizada
```

### Camadas de autorizacao

| Camada | Funcao |
|---|---|
| `RequireAuth` | Exige sessao web, exceto login e link assinado de aprovacao |
| `ModuleRoute` | Gate de UX por modulo |
| `AdminRoute` | Restringe backoffice a `admin` |
| `PermissionsV2` | Shadow/enforcement, feature flag, kill-switch e telemetria |
| Edge Function | Autoridade final para acao, empresa, documento e transicao |
| RLS | Restringe linhas em acessos diretos ao banco |
| API key | Escopo por servico, empresa/projeto, validade e revogacao |
| Link assinado | Token de uso controlado, expiracao e decisao idempotente |

## 6. Fluxo de compras e aprovacoes

```mermaid
sequenceDiagram
    autonumber
    actor S as Solicitante
    participant UI as Compras
    participant MUT as expense-mutation
    participant DOC as Processamento de anexo
    participant DB as PostgreSQL
    participant RULE as Motor de aprovacao
    actor A as Aprovador
    participant ACT as expense-approval-action
    participant INT as Integrador ERP
    participant ERP as SAP / Omie / outro
    participant WATCH as Watchers de status

    S->>UI: Cria ou edita rascunho
    UI->>MUT: Cabecalho, itens e rateios
    MUT->>DB: Persiste rascunho
    opt Anexos de compra
        UI->>DOC: Upload e extracao
        DOC->>DB: Metadados e campos extraidos
    end
    S->>UI: Submete documento
    UI->>MUT: submit(expense_id, revision)
    MUT->>RULE: Avalia regras por linha, CC, projeto e valor
    RULE->>DB: Cria segmentos e cadeias de aprovacao
    DB-->>A: Notificacao do nivel atual
    A->>ACT: Aprovar, rejeitar ou transferir
    ACT->>DB: Valida identidade, nivel, revisao e idempotencia
    alt Rejeitado
        ACT->>DB: Marca documento rejeitado
    else Todos os segmentos aprovados
        ACT->>DB: Marca documento aprovado
        ACT->>INT: Dispara integracao
        INT->>ERP: Cria documento contabil/operacional
        ERP-->>INT: DocEntry / DocNum / erro
        INT->>DB: Log e identificadores ERP
        WATCH->>ERP: Consulta sequencia e status atual
        WATCH->>DB: Atualiza PC, NF e pagamento
    else Ainda ha niveis ou segmentos
        ACT->>DB: Avanca somente a cadeia aplicavel
    end
```

### Maquina de estados da despesa

```mermaid
stateDiagram-v2
    [*] --> Rascunho
    Rascunho --> Pendente: submeter e gerar fluxo
    Rascunho --> Cancelado: excluir ou cancelar
    Pendente --> Pendente: aprovar nivel ou segmento
    Pendente --> Rejeitado: rejeitar
    Pendente --> Aprovado: todas as cadeias concluidas
    Pendente --> Rascunho: editar documento
    Rejeitado --> Rascunho: revisar
    Aprovado --> Integrando: dispatch automatico ou manual
    Integrando --> Aprovado: falha retentavel
    Integrando --> PCLancado: documento criado no ERP
    PCLancado --> NFEntrada: NF vinculada
    NFEntrada --> PagamentoParcial: baixa parcial
    NFEntrada --> Pago: baixa integral
    PagamentoParcial --> Pago: saldo zerado
    Pago --> Finalizado: conciliacao concluida
    Aprovado --> Cancelado: cancelamento administrativo
    Integrando --> Cancelado: impedir integracao
```

## 7. Regras de negocio de aprovacao

| ID | Regra |
|---|---|
| APR-01 | A regra e selecionada por empresa, tipo documental, valor, solicitante, centro de custo e projeto, respeitando prioridade e vigencia. |
| APR-02 | Um documento rateado gera segmentos independentes; todas as cadeias obrigatorias precisam concluir para a aprovacao global. |
| APR-03 | Cada aprovador visualiza apenas valores, linhas e detalhes pertencentes aos segmentos em que participa; outros ramos devem ser ofuscados. |
| APR-04 | O solicitante nao deve aprovar o proprio documento; o motor pula o nivel ou aplica o fallback configurado. |
| APR-05 | Dentro da mesma revisao, uma decisao anterior do mesmo aprovador pode ser reutilizada em novos niveis ou ramos equivalentes. |
| APR-06 | Reprocessar regras sem alterar o documento preserva aprovacoes compativeis ja realizadas. |
| APR-07 | Editar dados materiais ou anexos cria nova revisao e exige nova aprovacao. |
| APR-08 | Aprovacao, rejeicao, retry e integracao usam chave idempotente para impedir decisao ou lancamento duplicado. |
| APR-09 | Substituicoes possuem vigencia; transferencia administrativa deve gerar historico e notificacao. |
| APR-10 | Somente documentos efetivamente pendentes podem aparecer na fila de pendencias. |

## 8. Fluxo PagCorp

```mermaid
sequenceDiagram
    autonumber
    participant JOB as Busca PagCorp
    participant PAG as PagCorp API
    participant DB as Cache e logs
    participant AI as Classificacao documental
    actor OPS as Financeiro
    participant INT as pagcorp-to-sap
    participant ERP as ERP da empresa
    participant SET as Settlement watcher

    JOB->>PAG: Busca transacoes e prestacoes
    PAG-->>JOB: Transacoes, cartao, portador e anexos
    JOB->>DB: Upsert por empresa e transaction_id
    opt Prestacao aprovada, nao integrada e com documento
        JOB->>AI: Classifica documento uma unica vez
        AI-->>DB: Cache por hash do anexo
    end
    OPS->>INT: Escolhe PC ou lancamento contabil
    INT->>DB: Reserva lock/idempotencia
    alt Lancamento por transacao
        loop Cada transacao
            INT->>ERP: Debito + credito com valor, CC e projeto
        end
    else Pedido de compra
        INT->>ERP: PC, NF e referencias
    end
    ERP-->>INT: Identificadores ou erro
    INT->>DB: Resultado e relacoes
    SET->>ERP: Procura NF e situacao da baixa
    SET->>ERP: Emite pagamento quando elegivel
    SET->>DB: awaiting_invoice / awaiting_settlement / settled / error
```

### Regras PagCorp

- IA somente analisa prestacoes aprovadas, ainda nao integradas e com documento.
- O resultado da IA e persistido por hash; refresh de tela nao reprocessa anexo.
- Transacao estornada, cancelada ou ja integrada nao entra novamente na fila.
- Retry e idempotente por empresa, transacao e tipo de lancamento.
- Lancamento contabil em lote preserva um par debito/credito por transacao, com
  centro de custo, projeto e valor proprios.
- A baixa depende da NF/documento correspondente e pode aguardar PTAX ou
  configuracao contabil sem duplicar pagamento.

## 9. Fluxo de vendas e NFS-e

```mermaid
sequenceDiagram
    autonumber
    actor V as Usuario de vendas
    participant UI as Modulo Vendas
    participant DB as PostgreSQL
    participant ERP as ERP da empresa
    participant NF as Emissor / provedor NFS-e
    participant WATCH as Watcher fiscal
    participant REC as Contas a receber

    V->>UI: Cria pedido de venda
    UI->>DB: Registra origem e autoria
    Note over UI,DB: Anexo nao e obrigatorio
    UI->>ERP: Cria pedido de venda
    ERP-->>DB: DocEntry / DocNum
    V->>UI: Solicita emissao fiscal
    UI->>NF: Emite ou transmite NFS-e
    NF-->>DB: Numero, chave, protocolo, XML/PDF e status
    WATCH->>NF: Reconcilia autorizacao e arquivos
    WATCH->>DB: Atualiza estado fiscal
    V->>REC: Envia cobranca ou registra recebimento
    REC->>ERP: Cria baixa de contas a receber
    REC->>DB: Historico, itens e conciliacao
```

## 10. Modelo logico de dados

```mermaid
erDiagram
    COMPANIES ||--o{ SYSTEM_CREDENTIALS : possui
    COMPANIES ||--o{ EXPENSES : contextualiza
    COMPANIES ||--o{ USER_PROFILES : contextualiza
    COMPANIES ||--o{ INTEGRATION_LOG : registra

    EXPENSES ||--|{ EXPENSE_ITEMS : contem
    EXPENSES ||--o{ EXPENSE_ATTACHMENTS : anexa
    EXPENSES ||--o{ EXPENSE_APPROVAL_SEGMENTS : divide
    EXPENSES ||--o{ EXPENSE_APPROVAL_LOG : historico
    APPROVAL_RULES ||--|{ APPROVAL_RULE_LEVELS : define
    APPROVAL_RULES ||--o{ EXPENSE_APPROVAL_SEGMENTS : seleciona

    PERMISSION_GROUPS ||--o{ PERMISSION_GROUP_MODULES : concede
    PERMISSION_GROUPS ||--o{ USER_GROUP_ASSIGNMENTS : associa
    USER_PROFILES ||--o{ USER_GROUP_ASSIGNMENTS : recebe
    IDP_USER_MAPPING }o--|| USER_PROFILES : identifica

    PAGCORP_INTEGRATION_LOG }o--|| COMPANIES : pertence
    PAGCORP_DOCUMENT_RELATIONS }o--|| PAGCORP_INTEGRATION_LOG : relaciona
    SAP_PURCHASE_ORDER_CACHE ||--o{ PAGCORP_DOCUMENT_RELATIONS : referencia
    SAP_NF_ENTRADA_CACHE ||--o{ PAGCORP_DOCUMENT_RELATIONS : referencia
    SAP_VENDOR_PAYMENT_CACHE ||--o{ PAGCORP_DOCUMENT_RELATIONS : referencia

    NF_ENTRADA_IMPORTS ||--o{ NF_ENTRADA_LOGS : historico
    NF_ENTRADA_IMPORTS ||--o{ NF_ENTRADA_CONTAS_PAGAR : vincula

    PEDIDOS_VENDA_ERP ||--o{ SALES_ORDER_INVOICES : fatura
    BAIXAS_RECEBIMENTO ||--|{ BAIXAS_RECEBIMENTO_ITENS : rateia

    COMPANIES {
        uuid id PK
        string company_db UK
        string display_name
        string erp_type
        boolean is_active
    }
    EXPENSES {
        uuid id PK
        string company_db
        string status
        decimal total_amount
        int revision_number
        int sap_doc_entry
    }
    EXPENSE_ITEMS {
        uuid id PK
        uuid expense_id FK
        string item_code
        decimal quantity
        decimal unit_price
        string cost_center
        string project
    }
    EXPENSE_APPROVAL_SEGMENTS {
        uuid id PK
        uuid expense_id FK
        string segment_key
        decimal amount
        jsonb chain
        int current_level
        string status
    }
    APPROVAL_RULES {
        uuid id PK
        string name
        int priority
        decimal min_value
        decimal max_value
        string cost_center
        string project
    }
    APPROVAL_RULE_LEVELS {
        uuid id PK
        uuid rule_id FK
        int level_order
        string approver_email
    }
```

### Agrupamento fisico dos dados

| Grupo | Exemplos | Escrita predominante |
|---|---|---|
| Transacional | despesas, itens, adiantamentos, baixas | Gateways Edge |
| Configuracao | empresas, credenciais, regras, grupos | Admin/Edge |
| Cache ERP | pedidos, NFs, pagamentos e listas SAP | Watchers |
| Integracao | logs, relacoes, locks, retries | Proxies/workers |
| Auditoria | audit trail, divergencias, metricas | Backend append-only |
| Arquivos | comprovantes, XML, PDF e anexos | Storage gateway |

## 11. Autorizacoes por perfil

`V` = visualizar, `C` = criar, `D` = decidir, `A` = administrar.

| Perfil | Compras | Aprovar | Vendas | PagCorp | Fiscal/Financeiro | Auditoria | IAM/Integracoes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Solicitante | V/C proprios | - | conforme grupo | - | proprios | - | - |
| Aprovador | V escopo | D escopo | - | - | V escopo | historico aplicavel | - |
| Compras | V/C | transferencia autorizada | - | - | V | V operacional | monitor |
| Financeiro/Fiscal | V | conforme regra | recebimentos | V/C | V/C | V | monitor/retry |
| Vendas | - | conforme regra | V/C | - | recebimentos | V proprio | monitor |
| Auditor | V leitura | V historico | V leitura | V leitura | V leitura | V/A achados | - |
| Gestor | V amplo | D/transferir/reprocessar | V amplo | V amplo | V amplo | V | monitor/retry |
| Administrador | A | A | A | A | A | A | A |
| Consumidor API | escopo da chave | endpoint especifico | endpoint especifico | endpoint especifico | projetos permitidos | - | - |
| Agente de sistema | por job | notificacao/sync | sync | sync/baixa | sync | coleta | health/backup |

Regras adicionais:

- O escopo efetivo e a intersecao entre identidade, empresa, grupo, modulo,
  acao e escopo do documento.
- Administrador no frontend nao implica acesso irrestrito no ERP externo.
- Impersonacao deve ser auditada e, por padrao, operar em modo somente leitura.
- Dados pessoais globais do usuario, como nome, telefone e e-mail, sao
  compartilhados entre empresas; vinculos, grupos e acessos continuam por tenant.

## 12. Jornadas por perfil

```mermaid
flowchart TD
    START([Entrar com Google]) --> COMPANY[Selecionar empresa]
    COMPANY --> PROFILE{Perfil e modulos}

    PROFILE -->|Solicitante| J1[Criar rascunho]
    J1 --> J2[Informar fornecedor, itens e rateio]
    J2 --> J3[Anexar documentos quando exigido]
    J3 --> J4[Submeter e acompanhar]

    PROFILE -->|Aprovador| A1[Abrir fila pendente]
    A1 --> A2[Ver somente seu escopo]
    A2 --> A3{Decisao}
    A3 -->|Aprovar| A4[Avancar cadeia]
    A3 -->|Rejeitar| A5[Encerrar com motivo]
    A3 -->|Transferir| A6[Delegar com auditoria]

    PROFILE -->|Financeiro/Fiscal| F1[Conferir documento e ERP]
    F1 --> F2[Integrar ou reprocessar]
    F2 --> F3[Vincular NF e pagamento]
    F3 --> F4[Conciliar e finalizar]

    PROFILE -->|Vendas| V1[Criar pedido]
    V1 --> V2[Emitir e reconciliar NFS-e]
    V2 --> V3[Enviar e registrar recebimento]

    PROFILE -->|Auditor| AU1[Executar cruzamento]
    AU1 --> AU2[Investigar divergencia]
    AU2 --> AU3[Classificar achado e exportar evidencia]

    PROFILE -->|Administrador| AD1[Gerir empresas, usuarios e grupos]
    AD1 --> AD2[Configurar regras e credenciais]
    AD2 --> AD3[Monitorar health, retry, logs e acessos]
```

### Resultado esperado por jornada

| Perfil | Inicio | Conclusao de sucesso |
|---|---|---|
| Solicitante | Necessidade de compra/adiantamento | Documento submetido e rastreavel ate a liquidacao |
| Aprovador | Pendencia no seu nivel/segmento | Decisao unica, auditada e propagada corretamente |
| Compras | Demanda aprovada ou inconsistente | Pedido enviado ao ERP ou devolvido para correcao |
| Financeiro/Fiscal | Documento aprovado ou transacao PagCorp | NF, conta e pagamento conciliados |
| Vendas | Demanda comercial | Pedido, NFS-e e recebimento vinculados |
| Auditor | Periodo ou evento de risco | Evidencias e divergencias classificadas |
| Administrador | Mudanca operacional ou incidente | Configuracao aplicada com trilha e saude validada |

## 13. Fluxos de dados e fontes de verdade

| Informacao | Fonte primaria | Replica/cache | Consumidores |
|---|---|---|---|
| Identidade web | Google/Cloud Auth | perfil global e mapping IdP | toda a aplicacao |
| Permissao | grupos, roles e escopos no Postgres | snapshot cliente | rotas, botoes e Edge Functions |
| Documento interno | PostgreSQL | caches de tela | compras, aprovacao e auditoria |
| Documento contabil | ERP da empresa | caches ERP e relacoes | monitor, mapa e auditoria |
| Transacao de cartao | PagCorp | logs e relacoes por empresa | PagCorp e financeiro |
| NF fiscal | MasterTax/emissor/ERP | `nf_entrada_*` e storage | fiscal, compras e auditoria |
| Status financeiro | ERP e watchers | caches de NF/pagamento | cards, mapa e relatorios |
| Evidencia documental | Storage/provedor | metadados + hash | IA, aprovacao e auditoria |

Principio de consistencia: o status exibido deve ser derivado do estagio mais
recente comprovado pela fonte de verdade, e nao apenas do ultimo estado gravado
pela interface. Watchers reconciliam divergencias de forma idempotente.

## 14. Catalogo de integracoes

| Sistema | Direcao | Protocolo/autenticacao | Dados |
|---|---|---|---|
| SAP B1 Service Layer | bidirecional | HTTPS + sessao B1 | cadastros e documentos ERP |
| HanaAPI | leitura predominante | DynamicToken HMAC | views financeiras e aprovacoes |
| Omie | bidirecional | app key/secret via proxy | compras, vendas e financeiro |
| PagCorp | bidirecional | HMAC e campos cifrados | cartoes, transacoes e prestacoes |
| MasterTax/NFS-e | bidirecional | API token | notas, chave, XML/PDF e status |
| JumpCloud/Okta | entrada e provisionamento | API key ou service app | identidades e atributos |
| Synapse | bidirecional | credencial de integracao | usuarios, notificacoes e automacoes |
| Google/SMTP/WhatsApp | saida | OAuth/API/SMTP | autenticacao e notificacoes |
| IA | requisicao/resposta | API key no backend | extracao, classificacao e insights |
| Google Drive/S3 | saida | connector/credencial | backup e espelhamento de arquivos |

## 15. Controles transversais

- Multiempresa: toda operacao carrega e valida `company_db`.
- Idempotencia: acoes financeiras reservam chave antes de chamar o ERP.
- Concorrencia: locks de documento e watcher evitam processamento simultaneo.
- Resiliencia: retry com backoff, circuit breaker e kill-switch de integracao.
- Auditoria: decisoes, transferencias, integracoes e impersonacoes geram trilha.
- Observabilidade: metricas de Edge Functions, health de integracoes e filas.
- Privacidade: o backend deve devolver apenas os campos e segmentos autorizados.
- Ambientes de teste: empresas identificadas como teste nao executam notificacoes
  ou integracoes produtivas sem liberacao explicita.

## 16. Rastreabilidade no codigo

| Tema | Referencias |
|---|---|
| Rotas e modulos | `src/App.tsx` |
| Sessao multi-ERP | `src/contexts/SapContext.tsx` |
| Permissoes | `src/components/ModuleRoute.tsx`, `src/contexts/PermissionsV2Context.tsx` |
| Autorizacao backend | `supabase/functions/_shared/auth.ts`, `_shared/api-keys.ts` |
| Compras | `src/pages/Expenses.tsx`, `supabase/functions/expense-*` |
| Aprovacoes | `src/pages/ApprovalsHub.tsx`, `supabase/functions/approvals-feed` |
| PagCorp | `src/pages/PagCorp.tsx`, `supabase/functions/pagcorp-*` |
| Vendas | `src/pages/SalesHub.tsx`, `supabase/functions/sales-*` |
| Fiscal | `src/pages/NfEntrada.tsx`, `supabase/functions/nf-entrada-*` |
| Banco | `supabase/migrations`, `src/integrations/supabase/types.ts` |

## 17. Decisoes e ressalvas arquiteturais

1. O nome SAP ainda aparece em componentes historicos, embora o contexto atual
   seja multi-ERP; textos e adapters devem usar o ERP selecionado pela empresa.
2. O frontend implementa gates de experiencia, mas a seguranca depende da
   validacao equivalente no backend e da RLS.
3. Caches melhoram desempenho, mas nao substituem reconciliacao com o ERP.
4. Watchers e jobs sao atores do sistema e devem possuir identidade tecnica,
   escopo, locks, logs e alarmes proprios.
5. Este documento representa a arquitetura logica observada. Regras de rede,
   WAF, VPN, DNS e topologia privada precisam ser complementadas pela equipe de
   infraestrutura quando nao estiverem descritas no repositorio.
