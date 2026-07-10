import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, Loader2, FileWarning } from "lucide-react";

export interface AttachmentViewerProps {
  open: boolean;
  onClose: () => void;
  name: string;
  /** URL do arquivo (signed URL, object URL, etc). */
  url: string | null;
  /** Loading enquanto obtemos o URL. */
  loading?: boolean;
  /** MIME (opcional — se não vier, inferimos pela extensão). */
  mimeType?: string;
}

function inferMime(name: string, provided?: string): string {
  if (provided) return provided;
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) {
    return ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (["txt", "csv", "log"].includes(ext)) return "text/plain";
  if (ext === "html" || ext === "htm") return "text/html";
  return "application/octet-stream";
}

/**
 * Renderiza um anexo dentro de um modal. PDFs e imagens são renderizados
 * inline (funciona bem em mobile, evita pop-up bloqueado). Outros formatos
 * mostram um fallback com botão de download / abrir em nova aba.
 */
export function AttachmentViewer({
  open,
  onClose,
  name,
  url,
  loading,
  mimeType,
}: AttachmentViewerProps) {
  const mime = useMemo(() => inferMime(name, mimeType), [name, mimeType]);
  const kind: "pdf" | "image" | "other" = mime === "application/pdf"
    ? "pdf"
    : mime.startsWith("image/")
      ? "image"
      : "other";

  const [iframeError, setIframeError] = useState(false);
  useEffect(() => {
    if (open) setIframeError(false);
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="p-0 gap-0 flex flex-col w-screen h-[100dvh] max-w-none rounded-none border-0 sm:w-[95vw] sm:h-[90vh] sm:max-w-5xl sm:rounded-lg sm:border">

        <DialogHeader className="px-4 sm:px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <DialogTitle className="truncate text-base">{name}</DialogTitle>
            <div className="ml-auto flex items-center gap-1 shrink-0">
              {url && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = name;
                      a.rel = "noopener noreferrer";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    }}
                    title="Baixar"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Baixar</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    asChild
                  >
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir em nova aba"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="hidden sm:inline">Abrir</span>
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-muted/20 overflow-auto flex items-center justify-center">
          {loading || !url ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">Carregando anexo…</span>
            </div>
          ) : kind === "image" ? (
            <img
              src={url}
              alt={name}
              className="max-w-full max-h-full object-contain"
            />
          ) : kind === "pdf" && !iframeError ? (
            <iframe
              src={url}
              title={name}
              className="w-full h-full border-0 bg-white"
              onError={() => setIframeError(true)}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center px-6 py-10 text-muted-foreground max-w-md">
              <FileWarning className="w-10 h-10" />
              <p className="text-sm">
                Este tipo de arquivo não pode ser exibido no navegador. Use o botão abaixo para baixar ou abrir em uma nova aba.
              </p>
              <div className="flex gap-2">
                <Button asChild variant="secondary" size="sm">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-1.5" /> Abrir em nova aba
                  </a>
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                >
                  <Download className="w-4 h-4 mr-1.5" /> Baixar
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
