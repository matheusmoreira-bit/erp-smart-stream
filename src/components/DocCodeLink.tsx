import { internalDocCode } from "@/lib/doc-number";

/**
 * Link clicável com o identificador do documento.
 *
 * Documentos já integrados exibem o nº do ERP; despesas internas (ainda sem
 * DocNum) exibem o código interno (8 primeiros caracteres do id) — o mesmo
 * código usado na observação enviada ao ERP e na busca das listas.
 */
export function DocCodeLink({
  id,
  docNum,
  onOpen,
  className = "",
}: {
  id?: string | null;
  docNum?: number | string | null;
  onOpen: () => void;
  className?: string;
}) {
  const num = Number(docNum ?? 0);
  const internal = internalDocCode(id);
  const label = num > 0 ? `#${num}` : internal ? `#${internal}` : null;
  if (!label) return null;
  const isInternal = !(num > 0);

  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen();
      }}
      title={isInternal ? "Código interno — abrir detalhes do documento" : "Nº no ERP — abrir detalhes do documento"}
      aria-label={`Abrir detalhes do documento ${label}`}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        isInternal
          ? "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
          : "border-primary/30 text-primary hover:bg-primary/10"
      } ${className}`}
    >
      {label}
    </button>
  );
}
