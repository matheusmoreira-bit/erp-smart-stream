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
        const [prod, edits] = await Promise.all([
          sapQueryView<ProdRawRow>(session, "VW_USER_PRODUCTIVITY", undefined, !forceRefresh).catch(() => ({
            data: [] as ProdRawRow[],
            fromCache: false,
            hanaDisabled: true,
          })),
          sapQueryView<EditsRawRow>(session, "VW_USER_DOC_EDITS", undefined, !forceRefresh).catch(() => ({
            data: [] as EditsRawRow[],
            fromCache: false,
            hanaDisabled: true,
          })),
        ]);
        if (signal?.aborted) return;

        setHanaDisabled(!!prod.hanaDisabled && !!edits.hanaDisabled);

        // index edits by (UserCode|DocType|Periodo)
        const editsIdx = new Map<string, EditsRawRow>();
        for (const e of edits.data || []) {
          const k = `${e.UserCode}|${e.DocType}|${e.Periodo ?? ""}`;
          editsIdx.set(k, e);
        }

        const merged: UserProductivityRow[] = (prod.data || []).map((r) => {
          const k = `${r.UserCode}|${r.DocType}|${r.Periodo ?? ""}`;
          const e = editsIdx.get(k);
          const criados = toNum(r.DocsCriados);
          const valor = toNum(r.ValorTotalBRL);
          const cancelados = toNum(r.DocsCancelados);
          const edicoes = toNum(e?.EdicoesFeitas);
          const editadosUnicos = toNum(e?.DocsEditadosUnicos);
          return {
            userCode: r.UserCode,
            userName: r.UserName || r.UserCode,
            department: (r.Department || "Sem departamento").trim() || "Sem departamento",
            docType: r.DocType,
            periodo: r.Periodo || "",
            docsCriados: criados,
            valorTotalBRL: valor,
            docsCancelados: cancelados,
            edicoesFeitas: edicoes,
            docsEditadosUnicos: editadosUnicos,
            retrabalhoPct: criados > 0 ? ((edicoes + cancelados) / criados) * 100 : 0,
            ticketMedio: criados > 0 ? valor / criados : 0,
            score: computeScore(criados, valor, edicoes, cancelados),
          };
        });

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
