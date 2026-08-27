/**
 * Sincroniza views financeiras do HanaAPI com a planilha atual.
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
  MIDDLEWARE_SECRET: "INFORME_O_SAP_MIDDLEWARE_SECRET",
  SESSION_ID: "67aefea7-fa97-4674-bb8e-34a257669613-6422",
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
  validarCredenciais_();
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
    const rows = buscarViewCompleta_(companyDb, viewName, startedAt);
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

    const query = "?limit=" + HANA_FINANCE_SYNC.PAGE_SIZE + "&offset=" + offset;
    const objectName = encodeURIComponent(schema) + "." + encodeURIComponent(viewName);
    const url = removerBarraFinal_(HANA_FINANCE_SYNC.HANA_API_URL) +
      "/data/" + objectName + query;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        dynamictoken: gerarDynamicToken_(HANA_FINANCE_SYNC.MIDDLEWARE_SECRET),
        sessionid: HANA_FINANCE_SYNC.SESSION_ID,
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

function validarCredenciais_() {
  if (
    !HANA_FINANCE_SYNC.MIDDLEWARE_SECRET ||
    HANA_FINANCE_SYNC.MIDDLEWARE_SECRET === "INFORME_O_SAP_MIDDLEWARE_SECRET"
  ) {
    throw new Error("Defina MIDDLEWARE_SECRET no bloco HANA_FINANCE_SYNC.");
  }
}

function mensagemErro_(error) {
  return error && error.message ? String(error.message) : String(error || "Erro inesperado");
}
