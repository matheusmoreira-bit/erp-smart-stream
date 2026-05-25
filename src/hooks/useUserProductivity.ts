import { useCallback, useEffect, useMemo, useState } from "react";
import { useSap } from "@/contexts/SapContext";
import { sapQuery, sapQueryAll } from "@/lib/sap-client";

type RawUser = {
  InternalKey?: number | string;
  UserCode?: string;
  UserName?: string;
  Department?: number | string | null;
};

type RawDept = { Code?: number | string; Name?: string };

type RawSapDoc = {
  DocEntry?: number | string;
  DocDate?: string;
  UserSign?: number | string | null;
  DocTotal?: number | string | null;
  Cancelled?: string | null;
};

type ProductivityDocSource = {
  code: string;
  endpoint: string;
  label: string;
};

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

const DOC_SOURCES: ProductivityDocSource[] = [
  { code: "PC", endpoint: "PurchaseOrders", label: "Pedido de Compra" },
  { code: "PV", endpoint: "Orders", label: "Pedido de Venda" },
  { code: "NFE", endpoint: "PurchaseInvoices", label: "NF Entrada" },
  { code: "NFS", endpoint: "Invoices", label: "NF Saída" },
  { code: "REQ", endpoint: "PurchaseRequests", label: "Requisição" },
  { code: "COT", endpoint: "PurchaseQuotations", label: "Cotação" },
];

const CORE_DOC_SELECT = "DocEntry,DocDate,UserSign,DocTotal";
const DOC_SELECT_WITH_CANCEL = `${CORE_DOC_SELECT},Cancelled`;

const asArray = <T,>(data: unknown): T[] => {
  if (Array.isArray(data)) return data as T[];
  const value = (data as { value?: unknown })?.value;
  return Array.isArray(value) ? (value as T[]) : [];
};

const buildDateFilter = (sinceIso: string) => `DocDate ge '${sinceIso}'`;

const normalizePeriod = (docDate?: string): string => {
  if (!docDate) return "Sem data";
  return docDate.slice(0, 7) || "Sem data";
};

const isCancelled = (value: unknown): boolean => {
  const normalized = String(value ?? "").toUpperCase();
  return normalized === "TYES" || normalized === "Y" || normalized === "YES";
};

const userLookupKeys = (user: RawUser): string[] => {
  const keys = new Set<string>();
  if (user.InternalKey !== undefined && user.InternalKey !== null && user.InternalKey !== "") {
    keys.add(String(user.InternalKey));
  }
  if (user.UserCode) keys.add(user.UserCode);
  return Array.from(keys);
};

async function loadSapDocs(
  session: ReturnType<typeof useSap>["session"],
  source: ProductivityDocSource,
  sinceIso: string,
  useCache: boolean,
): Promise<{ source: ProductivityDocSource; rows: RawSapDoc[] }> {
  if (!session) return { source, rows: [] };

  const baseParams = { $filter: buildDateFilter(sinceIso) };
  const attempts: Array<Record<string, string>> = [
    { ...baseParams, $select: DOC_SELECT_WITH_CANCEL },
    { ...baseParams, $select: CORE_DOC_SELECT },
  ];

  for (const params of attempts) {
    try {
      const res = await sapQueryAll(session, source.endpoint, params, useCache);
      const rows = asArray<RawSapDoc>(res.data);
      if (rows.length > 0) return { source, rows };
    } catch (err) {
      console.warn(`Falha ao buscar ${source.endpoint} com select ${params.$select}:`, err);
    }
  }

  return { source, rows: [] };
}

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
        const since = new Date();
        since.setDate(since.getDate() - 180);
        const sinceIso = since.toISOString().slice(0, 10);
        const useCache = !forceRefresh;

        const [usersRes, deptsRes] = await Promise.all([
          sapQuery(
            session,
            "Users",
            { $select: "InternalKey,UserCode,UserName,Department", $top: 2000 },
            useCache,
          ).catch(() => ({ data: { value: [] } })),
          sapQuery(
            session,
            "Departments",
            { $select: "Code,Name", $top: 2000 },
            useCache,
          ).catch(() => ({ data: { value: [] } })),
        ]);
        if (signal?.aborted) return;

        const usersArr = asArray<RawUser>(usersRes.data);
        const deptsArr = asArray<RawDept>(deptsRes.data);

        const deptNameByCode = new Map<string, string>();
        for (const d of deptsArr) {
          if (d.Code !== undefined && d.Code !== null) {
            deptNameByCode.set(String(d.Code), d.Name || `Dept ${d.Code}`);
          }
        }

        const userInfo = new Map<string, { name: string; department: string }>();
        for (const u of usersArr) {
          const userName = u.UserName || u.UserCode || (u.InternalKey ? String(u.InternalKey) : "Usuário SAP");
          const deptName =
            u.Department !== undefined && u.Department !== null && u.Department !== ""
              ? deptNameByCode.get(String(u.Department)) || `Dept ${u.Department}`
              : "Sem departamento";

          for (const key of userLookupKeys(u)) {
            userInfo.set(key, { name: userName, department: deptName });
          }
        }

        const docResults = await Promise.all(
          DOC_SOURCES.map((source) => loadSapDocs(session, source, sinceIso, useCache)),
        );
        if (signal?.aborted) return;

        type Agg = {
          userCode: string;
          docType: string;
          periodo: string;
          docsCriados: number;
          valorTotalBRL: number;
          docsCancelados: number;
        };

        const agg = new Map<string, Agg>();

        for (const { source, rows: docs } of docResults) {
          for (const d of docs) {
            const userCode = d.UserSign !== undefined && d.UserSign !== null && d.UserSign !== "" ? String(d.UserSign) : "Sem usuário";
            const periodo = normalizePeriod(d.DocDate);
            const key = `${userCode}|${source.code}|${periodo}`;
            const cur =
              agg.get(key) ??
              { userCode, docType: source.code, periodo, docsCriados: 0, valorTotalBRL: 0, docsCancelados: 0 };

            cur.docsCriados += 1;
            cur.valorTotalBRL += toNum(d.DocTotal);
            if (isCancelled(d.Cancelled)) cur.docsCancelados += 1;
            agg.set(key, cur);
          }
        }

        const merged: UserProductivityRow[] = Array.from(agg.values()).map((r) => {
          const info = userInfo.get(r.userCode);
          const criados = r.docsCriados;
          const valor = r.valorTotalBRL;
          const cancelados = r.docsCancelados;
          const edicoes = 0;
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
