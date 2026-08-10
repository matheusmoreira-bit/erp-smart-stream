import { Coins, CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Campo de moeda dos formulários de compra/venda.
 *
 * Os usuários confundiam este campo com um campo de valor. Para evitar isso:
 * - ícone de moedas + prefixo com o símbolo dentro do controle;
 * - opções exibidas como "BRL — Real brasileiro" (nunca só números);
 * - nota de apoio explícita ("não é o valor do documento");
 * - quando definida pelo fornecedor, é exibida como selo travado (não parece input).
 */
export const CURRENCY_INFO: Record<string, { symbol: string; label: string }> = {
  BRL: { symbol: "R$", label: "Real brasileiro" },
  USD: { symbol: "US$", label: "Dólar americano" },
  EUR: { symbol: "€", label: "Euro" },
  GBP: { symbol: "£", label: "Libra esterlina" },
  ARS: { symbol: "AR$", label: "Peso argentino" },
  CAD: { symbol: "C$", label: "Dólar canadense" },
  CHF: { symbol: "CHF", label: "Franco suíço" },
  PYG: { symbol: "₲", label: "Guarani" },
  UYU: { symbol: "$U", label: "Peso uruguaio" },
};

export function currencySymbol(code?: string | null) {
  if (!code) return "—";
  return CURRENCY_INFO[code.toUpperCase()]?.symbol ?? code.toUpperCase();
}

export function currencyLabel(code?: string | null) {
  if (!code) return "";
  return CURRENCY_INFO[code.toUpperCase()]?.label ?? "";
}

/**
 * Normaliza a moeda vinda do ERP. O Service Layer devolve ISO ("BRL") e "##"
 * para PN multimoeda; a view HANA `VW_FORNECEDORES` devolve por extenso
 * ("Real", "Todas as Moedas"). Sem isso, "Todas as Moedas" era tratada como
 * uma moeda válida e o campo ficava travado, impedindo escolher a correta.
 *
 * Retorna o código ISO, "##" para multimoeda ou "" quando desconhecido.
 */
export function normalizeCurrencyCode(raw?: string | null): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (s === "##") return "##";
  const upper = s.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && upper !== "R$") return upper;
  const n = upper.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (n.includes("todas")) return "##";
  if (n.includes("real") || s === "R$") return "BRL";
  if (n.includes("dolar canadense")) return "CAD";
  if (n.includes("dolar")) return "USD";
  if (n.includes("euro")) return "EUR";
  if (n.includes("libra")) return "GBP";
  if (n.includes("franco")) return "CHF";
  if (n.includes("peso argentino")) return "ARS";
  if (n.includes("peso uruguaio")) return "UYU";
  if (n.includes("guarani")) return "PYG";
  return "";
}

interface CurrencyFieldProps {
  value: string;
  onChange?: (value: string) => void;
  options?: string[] | null;
  /** Travado quando a moeda vem do cadastro do fornecedor. */
  locked?: boolean;
  lockedHint?: string;
  loading?: boolean;
  required?: boolean;
  /** Mostra ícones de status (check/alerta) como nos demais campos obrigatórios. */
  showStatus?: boolean;
  id?: string;
}

export function CurrencyField({
  value,
  onChange,
  options,
  locked = false,
  lockedHint = "Definida pelo cadastro do fornecedor",
  loading = false,
  required = true,
  showStatus = true,
  id = "currency-field",
}: CurrencyFieldProps) {
  const list = options && options.length > 0 ? options : Object.keys(CURRENCY_INFO);
  // "##"/"Todas as Moedas" não é uma moeda: nunca deve travar o campo.
  const isMulti = normalizeCurrencyCode(value) === "##";
  const effectiveValue = isMulti ? "" : value;
  const effectiveLocked = locked && !isMulti;
  const filled = Boolean(effectiveValue);

  return (
    <div>
      <label
        htmlFor={id}
        className="text-xs text-muted-foreground mb-1 flex items-center gap-1"
      >
        <Coins className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
        <span>Moeda do documento{required ? " *" : ""}</span>
        {showStatus &&
          (filled ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" aria-label="Preenchido" />
          ) : (
            <AlertTriangle
              className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400"
              aria-label="Obrigatório"
            />
          ))}
        {loading && <span className="ml-1">(carregando…)</span>}
      </label>

      {locked || !onChange ? (
        <div
          id={id}
          aria-readonly
          className={`flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm ${
            filled ? "bg-muted/50 border-border" : "bg-amber-500/5 border-amber-500/50"
          }`}
        >
          <span className="inline-flex items-center rounded bg-background px-1.5 py-0.5 text-xs font-semibold text-muted-foreground border">
            {currencySymbol(value)}
          </span>
          <span className="font-medium">{value || "—"}</span>
          {currencyLabel(value) && (
            <span className="text-xs text-muted-foreground truncate">{currencyLabel(value)}</span>
          )}
          <Lock className="w-3 h-3 ml-auto text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            aria-label="Moeda do documento"
            className={`text-sm h-9 ${
              filled ? "bg-green-500/5 border-green-500/50 font-medium" : "bg-amber-500/5 border-amber-500/50"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground shrink-0">
                {currencySymbol(value)}
              </span>
              <SelectValue placeholder="Selecione a moeda" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {list.map((c) => (
              <SelectItem key={c} value={c}>
                <span className="font-medium">{c}</span>
                {currencyLabel(c) && (
                  <span className="text-muted-foreground"> — {currencyLabel(c)}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
        {locked ? lockedHint : "Apenas a moeda (ex.: BRL, USD). Não é o valor do documento."}
      </p>
    </div>
  );
}
