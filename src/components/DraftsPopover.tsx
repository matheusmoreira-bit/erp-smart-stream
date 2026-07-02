import { useState } from "react";
import { FileClock, Trash2, RotateCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { deleteDraft, useDocumentDrafts, type DraftDocType, type DocumentDraft } from "@/hooks/useDocumentDrafts";
import { toast } from "sonner";

interface Props {
  docType: DraftDocType;
  companyDb: string | undefined | null;
  onResume: (draft: DocumentDraft) => void;
}

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function daysUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const d = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  return d;
}

export function DraftsPopover({ docType, companyDb, onResume }: Props) {
  const { drafts, isLoading, refresh } = useDocumentDrafts(docType, companyDb);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deleteDraft(id);
      await refresh();
      toast.success("Esboço descartado");
    } catch {
      toast.error("Falha ao descartar esboço");
    } finally {
      setBusyId(null);
    }
  };

  const handleResume = (d: DocumentDraft) => {
    setOpen(false);
    onResume(d);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 relative">
          <FileClock className="w-4 h-4" />
          Esboços
          {drafts.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {drafts.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-medium text-foreground">Esboços pendentes</p>
          <p className="text-[11px] text-muted-foreground">
            Salvamos automaticamente enquanto você preenche. Expiram em 15 dias.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : drafts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-4">
              Nenhum esboço pendente.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {drafts.map((d) => (
                <li key={d.id} className="px-4 py-3 hover:bg-muted/30">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {d.preview || "Esboço sem título"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Atualizado {formatWhen(d.updated_at)} · expira em {daysUntil(d.expires_at)}d
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-primary"
                        title="Retomar"
                        onClick={() => handleResume(d)}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Descartar"
                        onClick={() => handleDelete(d.id)}
                        disabled={busyId === d.id}
                      >
                        {busyId === d.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
