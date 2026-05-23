import { useCallback, useEffect, useMemo, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, sapQueryAll } from "@/lib/sap-client";

/**
 * Productivity hook — consumes two HANA views:
 *  - VW_USER_PRODUCTIVITY: one row per (UserCode, DocType, Periodo)
 *  - VW_USER_DOC_EDITS:    one row per (UserCode, DocType, Periodo) — rework
 *
 * Expected columns (string/number tolerant):
 *  VW_USER_PRODUCTIVITY:
 *    UserCode, UserName, Department, DocType, DocsCriados,
 *    ValorTotalBRL, DocsCancelados, Periodo (YYYY-MM)
 *  VW_USER_DOC_EDITS:
 *    UserCode, Department, DocType, EdicoesFeitas, DocsEditadosUnicos, Periodo
 *
 * When the HANA views are not yet deployed, the hook returns empty
 * arrays + `hanaDisabled` flag so the UI can show a friendly message.
 */

export interface ProdRawRow {
  UserCode: string;
  UserName?: string;
  Department?: string;
  DocType: string;
  DocsCriados?: number | string;
  ValorTotalBRL?: number | string;
  DocsCancelados?: number | string;
  Periodo?: string;
}

export interface EditsRawRow {
  UserCode: string;
  Department?: string;
  DocType: string;
  EdicoesFeitas?: number | string;
  DocsEditadosUnicos?: number | string;
  Periodo?: string;
}

export interface UserProductivityRow {
  userCode: string;
  userName: string;
  department: string;
  docType: string;
  periodo: string;
  docsCriados: number;
  valorTotalBRL: number;
  docsCancelados: number;
  edicoesFeitas: number;
  docsEditadosUnicos: number;
  retrabalhoPct: number;
  ticketMedio: number;
  score: number;
}

export const DOC_TYPE_LABEL: Record<string, string> = {
  PC: "Pedido de Compra",
  PV: "Pedido de Venda",
  NFE: "NF Entrada",
  NFS: "NF Saída",
  PAG: "Pagamento Efetuado",
  REC: "Recebimento",
  REQ: "Requisição",
  COT: "Cotação",
  OPOR: "Pedido de Compra",
  ORDR: "Pedido de Venda",
  OPCH: "NF Entrada",
  OINV: "NF Saída",
  OVPM: "Pagamento Efetuado",
  ORCT: "Recebimento",
  OPRQ: "Requisição",
  OPQT: "Cotação",
};

const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function computeScore(criados: number, valor: number, edicoes: number, cancelados: number): number {
  return Math.max(0, Math.round(criados * 1 + valor / 10000 - edicoes * 0.3 - cancelados * 1));
}

export function useUserProductivity() {
  const { session } = useSap();
  const [rows, setRows] = useState<UserProductivityRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hanaDisabled, setHanaDisabled] = useState(false);

  const fetch = useCallback(
    async (forceRefresh = false, signal?: AbortSignal) => {
      if (!session || session.erpType !== "sap") {
        setRows([]);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        // Janela: últimos 180 dias
        const since = new Date();
        since.setDate(since.getDate() - 180);
        const sinceIso = since.toISOString().slice(0, 10);

        // Carrega usuários e departamentos para resolver nomes
        const [usersRes, deptsRes] = await Promise.all([
          sapQuery(
            session,
            "Users?$select=UserCode,UserName,Department&$top=2000",
            undefined,
            !forceRefresh,
          ).catch(() => ({ data: { value: [] } })),
          sapQuery(
            session,
            "Departments?$select=Code,Name&$top=2000",
            undefined,
            !forceRefresh,
          ).catch(() => ({ data: { value: [] } })),
        ]);
        if (signal?.aborted) return;

        type RawUser = { UserCode?: string; UserName?: string; Department?: number | string };
        type RawDept = { Code?: number | string; Name?: string };
        const usersArr: RawUser[] = Array.isArray((usersRes.data as { value?: unknown })?.value)
          ? ((usersRes.data as { value: RawUser[] }).value)
          : [];
        const deptsArr: RawDept[] = Array.isArray((deptsRes.data as { value?: unknown })?.value)
          ? ((deptsRes.data as { value: RawDept[] }).value)
          : [];

        const deptNameByCode = new Map<string, string>();
        for (const d of deptsArr) {
          if (d.Code !== undefined && d.Code !== null) {
            deptNameByCode.set(String(d.Code), d.Name || `Dept ${d.Code}`);
          }
        }
        const userInfo = new Map<string, { name: string; department: string }>();
        for (const u of usersArr) {
          if (!u.UserCode) continue;
          const deptName =
            u.Department !== undefined && u.Department !== null && u.Department !== ""
              ? deptNameByCode.get(String(u.Department)) || `Dept ${u.Department}`
              : "Sem departamento";
          userInfo.set(u.UserCode, { name: u.UserName || u.UserCode, department: deptName });
        }

        // Documentos a buscar
        const endpoints: { code: string; ep: string }[] = [
          { code: "PC", ep: "PurchaseOrders" },
          { code: "PV", ep: "Orders" },
          { code: "NFE", ep: "PurchaseInvoices" },
          { code: "NFS", ep: "Invoices" },
        ];

        const select = "$select=DocEntry,UserSign,DocTotal,DocTotalSys,DocDate,Cancelled,DocumentStatus";
        const filter = `$filter=DocDate ge '${sinceIso}'`;

        const docResults = await Promise.all(
          endpoints.map((e) =>
            sapQueryAll(session, `${e.ep}?${select}&${filter}`, undefined, !forceRefresh)
              .then((r) => ({ code: e.code, value: (r.data?.value as RawDoc[]) || [] }))
              .catch((err) => {
                console.warn(`Falha ao buscar ${e.ep}:`, err);
                return { code: e.code, value: [] as RawDoc[] };
              }),
          ),
        );
        if (signal?.aborted) return;

        type RawDoc = {
          DocEntry?: number;
          UserSign?: number | string;
          DocTotal?: number | string;
          DocTotalSys?: number | string;
          DocDate?: string;
          Cancelled?: string;
          DocumentStatus?: string;
        };

        // Agrega por (UserCode, DocType, Periodo)
        type Agg = {
          docsCriados: number;
          valorTotalBRL: number;
          docsCancelados: number;
        };
        const agg = new Map<string, Agg & { userCode: string; docType: string; periodo: string }>();

        for (const { code: docType, value } of docResults) {
          for (const d of value) {
            const userCode = d.UserSign !== undefined && d.UserSign !== null ? String(d.UserSign) : "";
            if (!userCode) continue;
            const periodo = (d.DocDate || "").slice(0, 7); // YYYY-MM
            const k = `${userCode}|${docType}|${periodo}`;
            const cur =
              agg.get(k) ??
              { userCode, docType, periodo, docsCriados: 0, valorTotalBRL: 0, docsCancelados: 0 };
            const cancelled = d.Cancelled === "tYES" || d.Cancelled === "Y";
            cur.docsCriados += 1;
            if (cancelled) cur.docsCancelados += 1;
            const valor = toNum(d.DocTotalSys ?? d.DocTotal);
            cur.valorTotalBRL += valor;
            agg.set(k, cur);
          }
        }

        const merged: UserProductivityRow[] = Array.from(agg.values()).map((r) => {
          const info = userInfo.get(r.userCode);
          const criados = r.docsCriados;
          const valor = r.valorTotalBRL;
          const cancelados = r.docsCancelados;
          const edicoes = 0; // sem fonte ADOC via OData — fica 0 até view dedicada existir
          return {
            userCode: r.userCode,
            userName: info?.name || r.userCode,
            department: info?.department || "Sem departamento",
            docType: r.docType,
            periodo: r.periodo,
            docsCriados: criados,
            valorTotalBRL: valor,
            docsCancelados: cancelados,
            edicoesFeitas: edicoes,
            docsEditadosUnicos: 0,
            retrabalhoPct: criados > 0 ? ((edicoes + cancelados) / criados) * 100 : 0,
            ticketMedio: criados > 0 ? valor / criados : 0,
            score: computeScore(criados, valor, edicoes, cancelados),
          };
        });

        setHanaDisabled(false);
        setRows(merged);
      } catch (e) {
        if (signal?.aborted) return;
        console.error("useUserProductivity error:", e);
        setError(e instanceof Error ? e.message : "Erro ao buscar produtividade");
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [session],
  );

  const refresh = useCallback(() => fetch(true), [fetch]);

  useEffect(() => {
    const c = new AbortController();
    fetch(false, c.signal);
    return () => c.abort();
  }, [fetch]);

  return { rows, isLoading, error, hanaDisabled, refresh };
}

export function docTypeLabel(code: string): string {
  return DOC_TYPE_LABEL[code] || code;
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function aggregateByDepartment(rows: UserProductivityRow[]) {
  const map = new Map<
    string,
    {
      department: string;
      docsCriados: number;
      valorTotalBRL: number;
      docsCancelados: number;
      edicoesFeitas: number;
      users: Set<string>;
      score: number;
    }
  >();
  for (const r of rows) {
    const cur =
      map.get(r.department) ?? {
        department: r.department,
        docsCriados: 0,
        valorTotalBRL: 0,
        docsCancelados: 0,
        edicoesFeitas: 0,
        users: new Set<string>(),
        score: 0,
      };
    cur.docsCriados += r.docsCriados;
    cur.valorTotalBRL += r.valorTotalBRL;
    cur.docsCancelados += r.docsCancelados;
    cur.edicoesFeitas += r.edicoesFeitas;
    cur.users.add(r.userCode);
    cur.score += r.score;
    map.set(r.department, cur);
  }
  return Array.from(map.values())
    .map((d) => ({
      ...d,
      usersCount: d.users.size,
      retrabalhoPct: d.docsCriados > 0 ? ((d.edicoesFeitas + d.docsCancelados) / d.docsCriados) * 100 : 0,
    }))
    .sort((a, b) => b.docsCriados - a.docsCriados);
}

export function aggregateByUser(rows: UserProductivityRow[]) {
  const map = new Map<
    string,
    {
      userCode: string;
      userName: string;
      department: string;
      docsCriados: number;
      valorTotalBRL: number;
      docsCancelados: number;
      edicoesFeitas: number;
      score: number;
    }
  >();
  for (const r of rows) {
    const cur =
      map.get(r.userCode) ?? {
        userCode: r.userCode,
        userName: r.userName,
        department: r.department,
        docsCriados: 0,
        valorTotalBRL: 0,
        docsCancelados: 0,
        edicoesFeitas: 0,
        score: 0,
      };
    cur.docsCriados += r.docsCriados;
    cur.valorTotalBRL += r.valorTotalBRL;
    cur.docsCancelados += r.docsCancelados;
    cur.edicoesFeitas += r.edicoesFeitas;
    cur.score += r.score;
    map.set(r.userCode, cur);
  }
  return Array.from(map.values())
    .map((u) => ({
      ...u,
      retrabalhoPct: u.docsCriados > 0 ? ((u.edicoesFeitas + u.docsCancelados) / u.docsCriados) * 100 : 0,
      ticketMedio: u.docsCriados > 0 ? u.valorTotalBRL / u.docsCriados : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export function aggregateByDocType(rows: UserProductivityRow[]) {
  const map = new Map<
    string,
    {
      docType: string;
      docsCriados: number;
      valorTotalBRL: number;
      docsCancelados: number;
      edicoesFeitas: number;
    }
  >();
  for (const r of rows) {
    const cur =
      map.get(r.docType) ?? {
        docType: r.docType,
        docsCriados: 0,
        valorTotalBRL: 0,
        docsCancelados: 0,
        edicoesFeitas: 0,
      };
    cur.docsCriados += r.docsCriados;
    cur.valorTotalBRL += r.valorTotalBRL;
    cur.docsCancelados += r.docsCancelados;
    cur.edicoesFeitas += r.edicoesFeitas;
    map.set(r.docType, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.docsCriados - a.docsCriados);
}

// helpers for filter dropdowns
export function useProductivityFilters(rows: UserProductivityRow[]) {
  return useMemo(() => {
    const departments = Array.from(new Set(rows.map((r) => r.department))).sort();
    const docTypes = Array.from(new Set(rows.map((r) => r.docType))).sort();
    const periodos = Array.from(new Set(rows.map((r) => r.periodo).filter(Boolean))).sort().reverse();
    return { departments, docTypes, periodos };
  }, [rows]);
}
