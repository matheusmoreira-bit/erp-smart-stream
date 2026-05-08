import { useState, useEffect } from "react";
import { Loader2, Phone, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSap } from "@/contexts/SapContext";
import { sapQuery } from "@/lib/sap-client";

interface EditPhoneDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userCode: string;
  userName: string;
  currentPhone?: string;
  onSave: (phone: string, source: "manual" | "sap") => Promise<void>;
}

export default function EditPhoneDialog({
  open,
  onOpenChange,
  userCode,
  userName,
  currentPhone,
  onSave,
}: EditPhoneDialogProps) {
  const { session } = useSap();
  const [phone, setPhone] = useState(currentPhone || "");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (open) setPhone(currentPhone || "");
  }, [open, currentPhone]);

  const handleImportFromSap = async () => {
    if (!session) {
      toast.error("Sem sessão SAP ativa");
      return;
    }
    setImporting(true);
    try {
      const safe = userCode.replace(/'/g, "''");
      const res = await sapQuery(
        session,
        `Users?$filter=UserCode eq '${safe}'&$select=UserCode,MobilePhone`,
        undefined,
        false,
      );
      const rows =
        (res as { data?: { value?: Array<{ MobilePhone?: string }> } }).data?.value ?? [];
      const mobile = rows[0]?.MobilePhone?.trim();
      if (!mobile) {
        toast.warning("SAP não tem telefone celular cadastrado para este usuário");
      } else {
        setPhone(mobile);
        toast.success("Telefone importado do SAP");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar do SAP");
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(phone.trim(), "manual");
      toast.success(phone.trim() ? "Telefone atualizado" : "Telefone removido");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar telefone");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-4 h-4" /> Telefone do Usuário
          </DialogTitle>
          <DialogDescription>
            Telefone WhatsApp de <span className="font-medium text-foreground">{userName}</span> (
            <span className="font-mono text-xs">{userCode}</span>)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone (com DDD)</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: 31972665309 ou +55 31 97266-5309"
                disabled={saving || importing}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleImportFromSap}
                disabled={importing || saving}
                title="Importar do SAP (MobilePhone)"
              >
                {importing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O número receberá notificações como aprovações pendentes via WhatsApp. Para remover,
              deixe em branco e salve.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
