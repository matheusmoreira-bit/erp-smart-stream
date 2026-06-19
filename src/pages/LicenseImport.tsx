import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { PageTitle } from "@/components/PageTitle";

const COMPANY_MAP: Record<string, string> = {
  "instituto": "SBO_INSTITUTO_ANA",
  "instituto ana": "SBO_INSTITUTO_ANA",
  "ana gaming": "SBO_ANAGAMING",
  "anagaming": "SBO_ANAGAMING",
  "ana": "SBO_ANAGAMING",
  "cactus tecnologia": "SBO_CACTUS",
  "cactus": "SBO_CACTUS",
  "cactus providers": "cactus_providers",
};

interface ParsedRow {
  user_code: string;
  user_name: string;
  is_locked: boolean;
  has_license: boolean;
  license_type: "PRO" | "CRM" | null;
  company_db: string;
  company_label: string;
  error?: string;
}

function detectDelimiter(line: string): string {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const c of line) if (c in counts) counts[c as keyof typeof counts]++;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]) || ",";
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === delim && !inQuotes) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const isTruthy = (v: string) => {
  const s = v.trim().toLowerCase();
  return ["✔", "x", "sim", "yes", "y", "1", "true", "t", "verdadeiro"].includes(s);
};

const isLocked = (v: string) => {
  const s = v.trim().toLowerCase();
  return ["sim", "yes", "y", "1", "true", "t", "verdadeiro"].includes(s);
};

function parseCsv(text: string): ParsedRow[] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const cCode = idx(["código do usuário", "codigo do usuario", "user code", "usercode", "código", "codigo"]);
  const cName = idx(["nome do usuário", "nome do usuario", "user name", "username", "nome"]);
  const cLock = idx(["bloqueado", "locked"]);
  const cPro = idx(["profissional", "pro"]);
  const cCrm = idx(["limited crm", "crm"]);
  const cCo = idx(["company", "empresa"]);

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line, delim);
    const company_label = cols[cCo] || "";
    const company_db = COMPANY_MAP[company_label.toLowerCase().trim()] || "";
    const isPro = cPro >= 0 && isTruthy(cols[cPro] || "");
    const isCrm = cCrm >= 0 && isTruthy(cols[cCrm] || "");
    const license_type: "PRO" | "CRM" | null = isPro ? "PRO" : isCrm ? "CRM" : null;
    const user_code = (cols[cCode] || "").trim();
    const row: ParsedRow = {
      user_code,
      user_name: (cols[cName] || user_code).trim(),
      is_locked: cLock >= 0 && isLocked(cols[cLock] || ""),
      has_license: !!license_type,
      license_type,
      company_db,
      company_label,
    };
    if (!user_code) row.error = "Código vazio";
    else if (!company_db) row.error = `Empresa desconhecida: "${company_label}"`;
    return row;
  });
}

export default function LicenseImportPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ ok: number; fail: number } | null>(null);

  const valid = useMemo(() => rows.filter((r) => !r.error), [rows]);
  const invalid = useMemo(() => rows.filter((r) => r.error), [rows]);

  const stats = useMemo(() => {
    const byCo: Record<string, { pro: number; crm: number; none: number }> = {};
    for (const r of valid) {
      const k = r.company_db;
      byCo[k] = byCo[k] || { pro: 0, crm: 0, none: 0 };
      if (r.license_type === "PRO") byCo[k].pro++;
      else if (r.license_type === "CRM") byCo[k].crm++;
      else byCo[k].none++;
    }
    return byCo;
  }, [valid]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setDone(null);
    const text = await file.text();
    setRows(parseCsv(text));
  };

  const runImport = async () => {
    if (valid.length === 0) return;
    setImporting(true);
    let ok = 0, fail = 0;
    // upsert in chunks
    const chunks: ParsedRow[][] = [];
    for (let i = 0; i < valid.length; i += 200) chunks.push(valid.slice(i, i + 200));
    for (const chunk of chunks) {
      const payload = chunk.map((r) => ({
        company_db: r.company_db,
        user_code: r.user_code,
        user_name: r.user_name,
        is_locked: r.is_locked,
        has_license: r.has_license,
        license_type: r.license_type,
      }));
      const { error } = await supabase
        .from("user_licenses")
        .upsert(payload, { onConflict: "company_db,user_code" });
      if (error) { fail += chunk.length; console.error(error); }
      else ok += chunk.length;
    }
    setImporting(false);
    setDone({ ok, fail });
    toast({ title: "Importação concluída", description: `${ok} atualizado(s), ${fail} falha(s)` });
  };

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Importar Licenças" />
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/usuarios/licencas")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Importar Licenças</h1>
              <p className="text-sm text-muted-foreground">Atualize a base de licenças via CSV</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <section className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Formato esperado</h2>
          <p className="text-xs text-muted-foreground">
            CSV com cabeçalho. Colunas: <code className="text-foreground">Código do usuário, Nome do usuário, Bloqueado, Profissional, Limited CRM, Company</code>.
            O delimitador (vírgula, ponto-e-vírgula ou tab) é detectado automaticamente.
          </p>
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Bloqueado:</strong> Sim/Não · <strong className="text-foreground">Profissional / Limited CRM:</strong> ✔ ou X marcam a licença.
          </p>
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Empresas reconhecidas:</strong> Instituto → SBO_INSTITUTO_ANA · ANA Gaming → SBO_ANAGAMING · Cactus Tecnologia → SBO_CACTUS · Cactus Providers → cactus_providers.
          </p>
        </section>

        <section className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <label htmlFor="csv-file" className="inline-flex items-center gap-2 cursor-pointer">
            <Button asChild variant="outline">
              <span><Upload className="w-4 h-4 mr-2" />Selecionar CSV</span>
            </Button>
          </label>
          {fileName && <p className="mt-3 text-xs text-muted-foreground">Arquivo: <span className="text-foreground font-mono">{fileName}</span></p>}
        </section>

        {rows.length > 0 && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Linhas válidas</p>
                <p className="text-2xl font-bold text-success">{valid.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">Linhas inválidas</p>
                <p className="text-2xl font-bold text-destructive">{invalid.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">PRO</p>
                <p className="text-2xl font-bold">{valid.filter((r) => r.license_type === "PRO").length}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground">CRM</p>
                <p className="text-2xl font-bold">{valid.filter((r) => r.license_type === "CRM").length}</p>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-3">Resumo por empresa</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {Object.entries(stats).map(([db, s]) => (
                  <div key={db} className="flex items-center justify-between border border-border rounded-md px-3 py-2">
                    <span className="font-mono text-foreground">{db}</span>
                    <span className="text-muted-foreground">PRO: <strong className="text-foreground">{s.pro}</strong> · CRM: <strong className="text-foreground">{s.crm}</strong> · Sem: <strong className="text-foreground">{s.none}</strong></span>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex items-center gap-3">
              <Button onClick={runImport} disabled={importing || valid.length === 0}>
                {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Importar {valid.length} linha(s)
              </Button>
              {done && <span className="text-sm text-muted-foreground">{done.ok} atualizado(s) · {done.fail} falha(s)</span>}
            </div>

            {invalid.length > 0 && (
              <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  <h3 className="text-sm font-semibold">Linhas com erro ({invalid.length})</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-muted-foreground"><th className="text-left px-2 py-1">Código</th><th className="text-left px-2 py-1">Empresa</th><th className="text-left px-2 py-1">Erro</th></tr></thead>
                    <tbody>
                      {invalid.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-t border-border"><td className="px-2 py-1 font-mono">{r.user_code || "—"}</td><td className="px-2 py-1">{r.company_label || "—"}</td><td className="px-2 py-1 text-destructive">{r.error}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {invalid.length > 50 && <p className="mt-2 text-xs text-muted-foreground">... e mais {invalid.length - 50}</p>}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold">Pré-visualização ({valid.length})</h3>
              </div>
              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-xs">
                  <thead className="bg-card sticky top-0">
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left px-3 py-2">Código</th>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Empresa</th>
                      <th className="text-left px-3 py-2">Licença</th>
                      <th className="text-left px-3 py-2">Bloqueado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valid.slice(0, 200).map((r, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5 font-mono">{r.user_code}</td>
                        <td className="px-3 py-1.5">{r.user_name}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.company_db}</td>
                        <td className="px-3 py-1.5">{r.license_type ? <Badge variant="secondary" className={r.license_type === "PRO" ? "bg-primary/15 text-primary" : "bg-accent/30"}>{r.license_type}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">{r.is_locked ? "🔒" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {valid.length > 200 && <p className="px-5 py-2 text-xs text-muted-foreground">Mostrando 200 de {valid.length} linhas.</p>}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
