# External Approvals API

API REST para outro sistema consumir os documentos em aprovação do SAP B1
(via Lovable Cloud), com endpoints para **listar**, **aprovar** e **rejeitar**.

A API funciona de forma análoga à API do SAP B1 Service Layer:
- Separada por **empresa** (`company_db`).
- O **solicitante** e o **aprovador** usam o **mesmo `UserCode` do SAP**.
- A autenticação contra o SAP é feita internamente com as credenciais admin
  configuradas na Lovable Cloud para cada empresa — o sistema externo
  **não precisa** saber a senha do SAP.

---

## 1. Endpoint base

```
POST https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api
```

Toda comunicação é `POST` com `Content-Type: application/json`. O corpo
informa qual operação executar via campo `op`.

---

## 2. Autenticação

Header obrigatório:

```
X-API-Key: <EXTERNAL_APPROVALS_API_KEY>
```

(Aceita também `Authorization: Bearer <chave>`.)

A chave é compartilhada pelo administrador da Lovable Cloud com o sistema
externo. Em caso de exposição, rotacione na Lovable Cloud → Backend → Secrets.

Respostas de erro de autenticação:
- `401` — `{"error":"API key inválida ou ausente"}`

---

## 3. Operações

### 3.1 Listar documentos pendentes para um usuário

**Request**
```http
POST /functions/v1/external-approvals-api
X-API-Key: ...
Content-Type: application/json

{
  "op": "list",
  "company_db": "SBO_EMPRESA_X",
  "user_code": "joao.silva"
}
```

**Response 200**
```json
{
  "company_db": "SBO_EMPRESA_X",
  "user_code": "joao.silva",
  "count": 2,
  "documents": [
    {
      "approval_request_id": 1287,
      "step": 1,
      "doc_object_type": "22",
      "doc_type_name": "Pedido de Compra",
      "doc_entry": 9912,
      "doc_num": 411420,
      "doc_total": 12500.00,
      "currency": "BRL",
      "card_code": "PJ000123",
      "card_name": "Fornecedor ACME LTDA",
      "remarks": "Compra urgente de insumos",
      "creation_date": "2026-05-22T14:33:00Z",
      "update_date": "2026-05-23T09:10:00Z",
      "originator_id": 47,
      "approver_user_code": "joao.silva"
    }
  ]
}
```

Campos importantes:
- `approval_request_id` — usar nas chamadas `approve` / `reject`.
- `step` — passo de aprovação do usuário; também usado nas decisões.
- `doc_object_type` — código SAP do objeto (22 = Pedido de Compra, 18 = NF de Entrada, etc.).
- `doc_total` / `currency` — valor e moeda do documento original (Draft).

### 3.2 Aprovar

```http
POST /functions/v1/external-approvals-api
X-API-Key: ...

{
  "op": "approve",
  "company_db": "SBO_EMPRESA_X",
  "user_code": "joao.silva",
  "approval_request_id": 1287,
  "step": 1,
  "remarks": "OK - dentro do orçamento"
}
```

**Response 200**
```json
{
  "success": true,
  "company_db": "SBO_EMPRESA_X",
  "user_code": "joao.silva",
  "approval_request_id": 1287,
  "step": 1,
  "decision": "approve"
}
```

### 3.3 Rejeitar

Idêntico ao `approve`, trocando `op` para `reject`:

```json
{
  "op": "reject",
  "company_db": "SBO_EMPRESA_X",
  "user_code": "joao.silva",
  "approval_request_id": 1287,
  "step": 1,
  "remarks": "Acima do limite — refazer cotação"
}
```

---

## 4. Tabela de erros

| HTTP | Causa típica                                                                |
|------|------------------------------------------------------------------------------|
| 400  | Campo obrigatório ausente (`op`, `company_db`, `user_code`, `approval_request_id`) ou inválido |
| 401  | `X-API-Key` ausente ou incorreto                                            |
| 405  | Método diferente de `POST`                                                  |
| 500  | Erro no servidor / SAP B1 (login, PATCH rejeitado, usuário não encontrado, etc.) |

O corpo de erro tem sempre o shape `{"error": "mensagem"}`.

---

## 5. Exemplos de cliente

### cURL
```bash
curl -X POST \
  https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api \
  -H "X-API-Key: $EXTERNAL_APPROVALS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"op":"list","company_db":"SBO_EMPRESA_X","user_code":"joao.silva"}'
```

### Node / TypeScript
```ts
const BASE = "https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api";
const KEY  = process.env.EXTERNAL_APPROVALS_API_KEY!;

async function call(payload: Record<string, unknown>) {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

// Listar
const pend = await call({ op: "list", company_db: "SBO_EMPRESA_X", user_code: "joao.silva" });

// Aprovar o primeiro
const first = pend.documents[0];
await call({
  op: "approve",
  company_db: "SBO_EMPRESA_X",
  user_code: "joao.silva",
  approval_request_id: first.approval_request_id,
  step: first.step,
  remarks: "OK",
});
```

### Python
```python
import os, requests

BASE = "https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api"
KEY  = os.environ["EXTERNAL_APPROVALS_API_KEY"]

def call(payload):
    r = requests.post(BASE, headers={"X-API-Key": KEY}, json=payload, timeout=60)
    r.raise_for_status()
    return r.json()

pend = call({"op": "list", "company_db": "SBO_EMPRESA_X", "user_code": "joao.silva"})
for doc in pend["documents"]:
    call({
        "op": "approve",
        "company_db": "SBO_EMPRESA_X",
        "user_code": "joao.silva",
        "approval_request_id": doc["approval_request_id"],
        "step": doc["step"],
        "remarks": "Aprovado automaticamente",
    })
```

---

## 6. Prompt para implantar no novo sistema

> **Contexto**: preciso integrar nosso sistema interno com a API REST
> **External Approvals API** (Lovable Cloud / SAP B1).
>
> **Endpoint único** (POST):
> `https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api`
>
> **Autenticação**: header `X-API-Key: <EXTERNAL_APPROVALS_API_KEY>` (variável de ambiente).
>
> **Operações** (campo `op` no body JSON):
> - `list` — body: `{op, company_db, user_code}` → retorna `{count, documents[]}` onde cada
>   documento tem `approval_request_id`, `step`, `doc_type_name`, `doc_num`,
>   `doc_total`, `currency`, `card_code`, `card_name`, `remarks`, `creation_date`.
> - `approve` — body: `{op, company_db, user_code, approval_request_id, step, remarks}` → `{success:true}`.
> - `reject` — mesmo shape que `approve`.
>
> **Identidade**: `user_code` é o **UserCode do SAP B1**; o mesmo identifica
> solicitantes e aprovadores. `company_db` separa as empresas (multi-tenant SAP).
>
> **Construa**:
> 1. Um cliente HTTP (`approvalsClient`) com um método `call(payload)` que faz POST
>    com o header `X-API-Key`, trata `!ok` e relança `error` da resposta.
> 2. Uma tela "Aprovações pendentes" que: pede ao usuário logado seu `user_code` e
>    `company_db` (ou usa dados já vinculados à sessão), chama `op:list` e
>    mostra a lista. Cada linha tem botões **Aprovar** e **Rejeitar** que abrem um
>    diálogo com campo `remarks` e chamam `op:approve|reject`, então recarregam a lista.
> 3. Estados de loading e mensagens de erro vindas do campo `error`.
> 4. Sem armazenar senha do SAP no novo sistema — a autenticação ao SAP é resolvida
>    pelo backend Lovable Cloud.
>
> A `EXTERNAL_APPROVALS_API_KEY` deve ser configurada como variável de ambiente
> no backend e **nunca** exposta ao frontend; faça as chamadas a partir do
> servidor (proxy/BFF) do novo sistema.

---

## 7. Observações operacionais

- A função faz **login → operação → logout** no SAP a cada chamada. Para
  cargas pesadas (>100 docs/min por usuário), considere expor um cache no
  consumidor.
- O PATCH é feito usando as credenciais admin configuradas; a decisão é
  registrada em nome do `user_code` informado (via `UserID` interno do SAP).
- Códigos de status SAP errados (`ardApproved`, `ardNotApproved`,
  `ardPending`) são tratados internamente — o cliente externo só precisa
  usar `approve` / `reject`.
