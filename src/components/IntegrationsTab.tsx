import { useEnabledErpTypes } from "@/hooks/useEnabledErpTypes";
import { SYSTEMS } from "@/lib/system-definitions";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function IntegrationsTab() {
  const { erpTypes, isLoading, toggle } = useEnabledErpTypes();

  const handleToggle = async (erpType: string, checked: boolean) => {
    await toggle(erpType, checked);
    const sys = SYSTEMS.find((s) => s.name === erpType);
    toast.success(`${sys?.label || erpType} ${checked ? "ativado" : "desativado"}`);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Integrações Disponíveis</h2>
        <p className="text-sm text-muted-foreground">
          Selecione quais ERPs ficam visíveis na tela de credenciais e no login.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {erpTypes.map((erp) => {
          const sys = SYSTEMS.find((s) => s.name === erp.erp_type);
          if (!sys) return null;
          const Icon = sys.icon;

          return (
            <div
              key={erp.erp_type}
              className={`flex items-center gap-4 p-4 rounded-xl border border-border bg-card transition-opacity ${
                !erp.is_active ? "opacity-50" : ""
              }`}
            >
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground">{sys.label}</p>
                <p className="text-xs text-muted-foreground truncate">{sys.description}</p>
              </div>
              <Badge
                variant={erp.is_active ? "default" : "secondary"}
                className="text-[10px] mr-2"
              >
                {erp.is_active ? "Ativo" : "Inativo"}
              </Badge>
              <Switch
                checked={erp.is_active}
                onCheckedChange={(checked) => handleToggle(erp.erp_type, checked)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
