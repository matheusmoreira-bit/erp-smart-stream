import { useState } from "react";
import { Paperclip, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  formatFileSize,
  getRegistrationAttachmentUrl,
  type RegistrationAttachment,
} from "@/lib/registration-attachments";

export function RegistrationAttachmentList({
  attachments,
  compact,
}: {
  attachments: RegistrationAttachment[];
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!attachments?.length) return null;

  const open = async (att: RegistrationAttachment) => {
    setBusy(att.path || att.name);
    try {
      const url = await getRegistrationAttachmentUrl(att);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao abrir anexo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={compact ? "flex flex-wrap gap-2 mt-2" : "space-y-2"}>
      {attachments.map((att) => (
        <Button
          key={att.path || att.name}
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 max-w-full"
          disabled={busy === (att.path || att.name)}
          onClick={() => open(att)}
        >
          {busy === (att.path || att.name) ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <Paperclip className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{att.name}</span>
          {att.size ? <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(att.size)}</span> : null}
          <Download className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </Button>
      ))}
    </div>
  );
}

export default RegistrationAttachmentList;
