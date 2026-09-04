/**
 * Sincroniza dados financeiros do HanaAPI e do ERP Flow com a planilha atual.
 *
 * Instalacao:
 * 1. Abra Extensoes > Apps Script na planilha de destino.
 * 2. Cole este arquivo em Code.gs e salve.
 * 3. Reabra a planilha e use HanaAPI > Empresa > Consulta.
 */

const HANA_FINANCE_SYNC = Object.freeze({
  COMPANIES: Object.freeze([
    "SBO_ANAGAMING",
    "SBO_CACTUS",
    "SBO_OPENGAMING",
  ]),
  VIEWS: Object.freeze({
    PAYMENTS: "VW_FIN_PAGAMENTOS_SAP",
    FISCAL_ORDERS: "VW_FIN_PEDIDOS_FISCAL",
    OPEN_ORDERS: "VW_FIN_PEDIDOS_ABERTO",
  }),
  PAGE_SIZE: 5000,
  MAX_PAGES: 200,
  MAX_RUNTIME_MS: 5 * 60 * 1000,
  WRITE_CHUNK_SIZE: 10000,
  HANA_API_URL: "http://201.48.79.205:8001",
  DYNAMIC_TOKEN_SECRET: "8f3c7b2a9e1d4f6a5b8c0e3d2f1a6c5b9d0e7f4a2b1c6d5e8f9a0b3c2d1e4f7a",
  SESSION_ID: "67aefea7-fa97-4674-bb8e-34a257669613-6422",
  ERP_FLOW_APPROVALS_API_URL:
    "https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/external-approvals-api",
  ERP_FLOW_APPROVALS_API_KEY:
    "erpf_apr_be4c5771c526628677be4e04696680505b917e60782b6bc5b9351af4323df17a",
});

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("HanaAPI")
    .addSubMenu(criarMenuEmpresa_(ui, "ANA Gaming", "AnaGaming"))
    .addSubMenu(criarMenuEmpresa_(ui, "Cactus", "Cactus"))
    .addSubMenu(criarMenuEmpresa_(ui, "Open Gaming", "OpenGaming"))
    .addToUi();
}

function criarMenuEmpresa_(ui, label, functionPrefix) {
  return ui.createMenu(label)
    .addItem("Pagamentos SAP", "consultar" + functionPrefix + "Pagamentos")
    .addItem("Pedidos - Fiscal", "consultar" + functionPrefix + "Fiscal")
    .addItem("Pedidos - Em aberto", "consultar" + functionPrefix + "EmAberto");
}

function consultarAnaGamingPagamentos() {
  atualizarConsulta_("SBO_ANAGAMING", HANA_FINANCE_SYNC.VIEWS.PAYMENTS);
}

function consultarAnaGamingFiscal() {
  atualizarConsulta_("SBO_ANAGAMING", HANA_FINANCE_SYNC.VIEWS.FISCAL_ORDERS);
}

function consultarAnaGamingEmAberto() {
  atualizarConsulta_("SBO_ANAGAMING", HANA_FINANCE_SYNC.VIEWS.OPEN_ORDERS);
}

function consultarCactusPagamentos() {
  atualizarConsulta_("SBO_CACTUS", HANA_FINANCE_SYNC.VIEWS.PAYMENTS);
}

function consultarCactusFiscal() {
  atualizarConsulta_("SBO_CACTUS", HANA_FINANCE_SYNC.VIEWS.FISCAL_ORDERS);
}

function consultarCactusEmAberto() {
  atualizarConsulta_("SBO_CACTUS", HANA_FINANCE_SYNC.VIEWS.OPEN_ORDERS);
}

function consultarOpenGamingPagamentos() {
  atualizarConsulta_("SBO_OPENGAMING", HANA_FINANCE_SYNC.VIEWS.PAYMENTS);
}

function consultarOpenGamingFiscal() {
  atualizarConsulta_("SBO_OPENGAMING", HANA_FINANCE_SYNC.VIEWS.FISCAL_ORDERS);
}

function consultarOpenGamingEmAberto() {
  atualizarConsulta_("SBO_OPENGAMING", HANA_FINANCE_SYNC.VIEWS.OPEN_ORDERS);
}

function atualizarConsulta_(companyDb, viewName) {
  validarEmpresa_(companyDb);
  validarView_(viewName);
  validarCredenciais_(viewName);
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(5000)) {
    ui.alert(
      "Atualizacao em andamento",
      "Outra pessoa ja esta atualizando esta planilha. Tente novamente em instantes.",
      ui.ButtonSet.OK,
    );
    return;
  }

  const startedAt = Date.now();
  let escritaIniciada = false;
  try {
    spreadsheet.toast("Consultando " + viewName + "...", companyDb, 20);
    const rows = buscarDadosConsulta_(companyDb, viewName, startedAt);
    escritaIniciada = true;
    spreadsheet.toast("Atualizando a aba atual...", companyDb, 20);
    atualizarAba_(sheet, rows, companyDb, viewName);
    SpreadsheetApp.flush();

    spreadsheet.toast("Atualizacao concluida.", companyDb, 8);
    ui.alert(
      "Atualizacao concluida - " + companyDb,
      viewName + ": " + rows.length + " linha(s)",
      ui.ButtonSet.OK,
    );
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    spreadsheet.toast("Falha na atualizacao.", companyDb, 10);
    ui.alert(
      "Falha ao atualizar " + companyDb,
      mensagemErro_(error) + (escritaIniciada
        ? "\n\nA gravacao pode ter sido concluida apenas parcialmente."
        : "\n\nAs abas existentes nao foram alteradas."),
      ui.ButtonSet.OK,
    );
  } finally {
    lock.releaseLock();
  }
}

function buscarDadosConsulta_(companyDb, viewName, startedAt) {
  const hanaRows = buscarViewCompleta_(companyDb, viewName, startedAt);
  if (viewName !== HANA_FINANCE_SYNC.VIEWS.OPEN_ORDERS) return hanaRows;

  const openOrders = hanaRows
    .filter(ehStatusPedidoPendente_)
    .map(function(row) {
      return Object.assign({ Origem: "HanaAPI" }, row);
    });
  const approvalOrders = buscarPedidosEmAprovacao_(companyDb);
  return mesclarPedidosEmAberto_(openOrders, approvalOrders)
    .filter(ehStatusPedidoPendente_);
}

function ehStatusPedidoPendente_(row) {
  const status = String(row && row.Status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return status === "pendente" || status === "pendente de aprovacao";
}

function mesclarPedidosEmAberto_(openOrders, approvalOrders) {
  const byKey = Object.create(null);
  const order = [];

  function addOrMerge(row, preferIncoming) {
    const key = chavePedido_(row);
    if (!key) {
      order.push(row);
      return;
    }
    if (!byKey[key]) {
      byKey[key] = row;
      order.push(row);
      return;
    }

    const current = byKey[key];
    const primary = preferIncoming ? row : current;
    const secondary = preferIncoming ? current : row;
    const merged = Object.assign({}, secondary, primary);
    Object.keys(secondary).forEach(function(field) {
      if (merged[field] === "" || merged[field] === null || merged[field] === undefined) {
        merged[field] = secondary[field];
      }
    });
    if (
      /^\d+$/.test(String(merged.Autor || "").trim()) &&
      !/^\d+$/.test(String(secondary.Autor || "").trim())
    ) {
      merged.Autor = secondary.Autor;
    }
    const index = order.indexOf(current);
    if (index >= 0) order[index] = merged;
    byKey[key] = merged;
  }

  openOrders.forEach(function(row) { addOrMerge(row, false); });
  approvalOrders.forEach(function(row) { addOrMerge(row, true); });
  return order;
}

function chavePedido_(row) {
  const draftEntry = String(row["Nº de esboço de documento"] || "").trim();
  if (draftEntry) return "draft:" + draftEntry;
  const docNum = String(row["Nº documento"] || "").trim();
  return docNum ? "doc:" + docNum : "";
}

function buscarPedidosEmAprovacao_(companyDb) {
  const response = UrlFetchApp.fetch(HANA_FINANCE_SYNC.ERP_FLOW_APPROVALS_API_URL, {
    method: "post",
    contentType: "application/json",
    headers: {
      "X-API-Key": HANA_FINANCE_SYNC.ERP_FLOW_APPROVALS_API_KEY,
      Accept: "application/json",
    },
    payload: JSON.stringify({
      op: "list",
      company_db: companyDb,
      doc_object_type: "22",
    }),
    followRedirects: true,
    muteHttpExceptions: true,
  });
  validarHttp_(response, "ERP Flow - pedidos em aprovacao de " + companyDb);

  let payload;
  try {
    payload = JSON.parse(response.getContentText() || "{}");
  } catch (error) {
    throw new Error("ERP Flow retornou JSON invalido: " + mensagemErro_(error));
  }
  if (!payload || !Array.isArray(payload.documents)) {
    throw new Error("Formato de resposta inesperado da API de aprovacoes do ERP Flow.");
  }

  return payload.documents
    .filter(function(document) {
      return String(document.doc_object_type || "") === "22";
    })
    .map(normalizarPedidoEmAprovacao_);
}

function normalizarPedidoEmAprovacao_(document) {
  const pendingApprovers = Array.isArray(document.pending_approvers)
    ? document.pending_approvers
    : [];
  return {
    Origem: "ERP Flow - Em aprovacao",
    "Tipo de documento": document.doc_type_name || "Pedido de Compra",
    "Nº documento": document.doc_num || "",
    "Nº de esboço de documento": document.doc_entry || "",
    Autor: document.originator_name || document.originator_user_code || document.originator_id || "",
    Status: "Pendente de aprovacao",
    "Observações": document.remarks || "",
    "Data do documento": document.doc_date || "",
    "Data de criação": document.creation_date || "",
    "Data de atualização": document.update_date || "",
    "Data de vencimento": document.due_date || "",
    "Data de pagamento": document.payment_date || "",
    "Nome do PN": document.card_name || "",
    "Código PN": document.card_code || "",
    "Total do documento (MC)": numeroOuVazio_(document.doc_total),
    Moeda: document.currency || "BRL",
    "Centro de custo": document.cost_center || "",
    "Centros de custo": listaParaTexto_(document.cost_centers),
    Departamento: document.department || "",
    Departamentos: listaParaTexto_(document.departments),
    Projeto: document.project || "",
    Projetos: listaParaTexto_(document.projects),
    "ID da solicitação de aprovação": document.approval_request_id || "",
    "Etapa atual": document.step || "",
    "Aprovadores pendentes": pendingApprovers.map(function(approver) {
      const name = approver.user_name || approver.user_code || approver.email || approver.user_id || "";
      return name + (approver.step ? " (etapa " + approver.step + ")" : "");
    }).join(", "),
  };
}

function listaParaTexto_(value) {
  return Array.isArray(value) ? value.join(", ") : (value || "");
}

function numeroOuVazio_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function buscarViewCompleta_(schema, viewName, startedAt) {
  const allRows = [];
  let offset = 0;

  for (let page = 0; page < HANA_FINANCE_SYNC.MAX_PAGES; page += 1) {
    if (Date.now() - startedAt > HANA_FINANCE_SYNC.MAX_RUNTIME_MS) {
      throw new Error(
        "A consulta excedeu cinco minutos antes de concluir. " +
        "Reduza o volume da view ou execute cada view separadamente.",
      );
    }

    const query = "?schema=" + encodeURIComponent(schema) +
      "&limit=" + HANA_FINANCE_SYNC.PAGE_SIZE + "&offset=" + offset;
    const url = removerBarraFinal_(HANA_FINANCE_SYNC.HANA_API_URL) +
      "/data/" + encodeURIComponent(viewName) + query;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        Authorization: "Bearer " + gerarDynamicToken_(
          HANA_FINANCE_SYNC.DYNAMIC_TOKEN_SECRET,
        ),
        "X-SAP-Session-ID": HANA_FINANCE_SYNC.SESSION_ID,
        Accept: "application/json",
      },
      followRedirects: true,
      muteHttpExceptions: true,
    });
    validarHttp_(response, schema + "." + viewName + " (offset " + offset + ")");

    const pageRows = extrairLinhas_(response.getContentText());
    Array.prototype.push.apply(allRows, pageRows);
    if (pageRows.length < HANA_FINANCE_SYNC.PAGE_SIZE) return allRows;
    offset += pageRows.length;
  }

  throw new Error(
    schema + "." + viewName + " excedeu " + HANA_FINANCE_SYNC.MAX_PAGES + " paginas.",
  );
}

function extrairLinhas_(text) {
  let payload;
  try {
    payload = JSON.parse(text || "[]");
  } catch (error) {
    throw new Error("HanaAPI retornou JSON invalido: " + mensagemErro_(error));
  }

  if (Array.isArray(payload)) {
    const rows = [];
    payload.forEach(function(group) {
      if (group && typeof group === "object" && Array.isArray(group.data)) {
        Array.prototype.push.apply(rows, group.data);
      } else if (Array.isArray(group)) {
        Array.prototype.push.apply(rows, group);
      } else if (group && typeof group === "object") {
        rows.push(group);
      }
    });
    return rows;
  }
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    return payload.data;
  }
  throw new Error("Formato de resposta inesperado do HanaAPI.");
}

function atualizarAba_(sheet, rows, companyDb, viewName) {
  const oldFilter = sheet.getFilter();
  if (oldFilter) oldFilter.remove();

  const headers = coletarCabecalhos_(rows);
  sheet.clearContents();
  if (!headers.length) {
    sheet.getRange(1, 1).setValue("Sem registros para " + companyDb);
    sheet.getRange(1, 1).setNote(
      "Fonte: " + companyDb + "." + viewName +
      "\nAtualizado em: " + new Date().toISOString(),
    );
    return;
  }

  garantirDimensoes_(sheet, rows.length + 1, headers.length);
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange
    .setFontWeight("bold")
    .setBackground("#1f2937")
    .setFontColor("#ffffff");
  headerRange.getCell(1, 1).setNote(
    "Fonte: " + companyDb + "." + viewName +
    "\nAtualizado em: " + new Date().toISOString(),
  );

  for (let start = 0; start < rows.length; start += HANA_FINANCE_SYNC.WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + HANA_FINANCE_SYNC.WRITE_CHUNK_SIZE);
    const values = chunk.map(function(row) {
      return headers.map(function(header) {
        return valorSeguroParaCelula_(row[header]);
      });
    });
    sheet.getRange(start + 2, 1, values.length, headers.length).setValues(values);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, rows.length + 1, headers.length).createFilter();
  sheet.autoResizeColumns(1, Math.min(headers.length, 50));
}

function coletarCabecalhos_(rows) {
  const seen = Object.create(null);
  const headers = [];
  rows.forEach(function(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    Object.keys(row).forEach(function(key) {
      if (!seen[key]) {
        seen[key] = true;
        headers.push(key);
      }
    });
  });
  return headers;
}

function valorSeguroParaCelula_(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text.length > 49000 ? text.slice(0, 49000) + "..." : text;
}

function garantirDimensoes_(sheet, requiredRows, requiredColumns) {
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumns - sheet.getMaxColumns(),
    );
  }
}

function gerarDynamicToken_(secret) {
  const hourBlock = String(Math.floor(Date.now() / 1000 / 3600));
  const signature = Utilities.computeHmacSha256Signature(
    hourBlock,
    secret,
    Utilities.Charset.UTF_8,
  );
  return signature.map(function(byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function validarHttp_(response, operation) {
  const status = response.getResponseCode();
  if (status >= 200 && status < 300) return;
  const body = response.getContentText().slice(0, 800);
  throw new Error(operation + " falhou [HTTP " + status + "]: " + body);
}

function removerBarraFinal_(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function validarEmpresa_(companyDb) {
  if (!HANA_FINANCE_SYNC.COMPANIES.includes(companyDb)) {
    throw new Error("Base nao permitida: " + companyDb);
  }
}

function validarView_(viewName) {
  const allowedViews = Object.keys(HANA_FINANCE_SYNC.VIEWS).map(function(key) {
    return HANA_FINANCE_SYNC.VIEWS[key];
  });
  if (!allowedViews.includes(viewName)) {
    throw new Error("Consulta nao permitida: " + viewName);
  }
}

function validarCredenciais_(viewName) {
  if (
    !HANA_FINANCE_SYNC.DYNAMIC_TOKEN_SECRET ||
    !HANA_FINANCE_SYNC.SESSION_ID
  ) {
    throw new Error("Credenciais do HanaAPI ausentes no bloco HANA_FINANCE_SYNC.");
  }
  if (
    viewName === HANA_FINANCE_SYNC.VIEWS.OPEN_ORDERS &&
    (!HANA_FINANCE_SYNC.ERP_FLOW_APPROVALS_API_URL ||
      !HANA_FINANCE_SYNC.ERP_FLOW_APPROVALS_API_KEY)
  ) {
    throw new Error("Credenciais da API de aprovacoes do ERP Flow ausentes.");
  }
}

function mensagemErro_(error) {
  return error && error.message ? String(error.message) : String(error || "Erro inesperado");
}
