import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Building2,
  Search,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanies } from "@/hooks/useCompanies";
import {
  MODULES,
  VIEW_ONLY_MODULES,
  PERMISSION_ACTIONS,
  type PermissionAction,
} from "@/hooks/usePermissions";

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "Ver",
  create: "Criar",
  edit: "Editar",
  delete: "Excluir",
  approve: "Aprovar",
  integrate: "Integrar",
  export: "Exportar",
};

const ALL_MODULES = [...MODULES, ...VIEW_ONLY_MODULES];

interface SapGroup {
  sap_group_code: string;
  sap_group_name: string | null;
}

interface Mapping {
  id: string;
  company_db: string;
  sap_group_code: string;
  sap_group_name: string | null;
  module_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
  can_integrate: boolean;
  can_export: boolean;
}

export default function SapGroupMappingManager({ onBack }: { onBack: () => void }) {
  const { companies, loading: loadingCompanies } = useCompanies(true);
  const [companyDb, setCompanyDb] = useState<string>("");
  const [groups, setGroups] = useState<SapGroup[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!companyDb) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: gs }, { data: ms }] = await Promise.all([
        supabase
          .from("sap_groups_cache")
          .select("sap_group_code, sap_group_name")
          .eq("company_db", companyDb)
          .order("sap_group_name"),
        supabase
          .from("sap_group_mapping")
          .select("*")
          .eq("company_db", companyDb)
          .order("sap_group_name")
          .order("module_key"),
      ]);
      if (cancelled) return;
      setGroups((gs || []) as SapGroup[]);
      setMappings((ms || []) as Mapping[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyDb]);

  const filteredMappings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter(
      (m) =>
        m.sap_group_name?.toLowerCase().includes(q) ||
        m.sap_group_code.toLowerCase().includes(q) ||
        m.module_key.toLowerCase().includes(q),
    );
  }, [mappings, search]);

  async function refreshMappings() {
    if (!companyDb) return;
    const { data } = await supabase
      .from("sap_group_mapping")
      .select("*")
      .eq("company_db", companyDb)
      .order("sap_group_name")
      .order("module_key");
    setMappings((data || []) as Mapping[]);
  }

  async function handleSyncGroups() {
    if (!companyDb) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sap-groups-sync", {
        body: { company_db: companyDb },
      });
      if (error) throw error;
      toast.success(`Sincronizado: ${(data as any)?.count ?? 0} grupos`);
      const { data: gs } = await supabase
        .from("sap_groups_cache")
        .select("sap_group_code, sap_group_name")
        .eq("company_db", companyDb)
        .order("sap_group_name");
      setGroups((gs || []) as SapGroup[]);
    } catch (e: any) {
      toast.error(`Falha ao sincronizar: ${e?.message ?? e}`);
    } finally {
      setSyncing(false);
    }
  }

  async function saveMapping(m: Mapping) {
    const payload = {
      company_db: m.company_db,
      sap_group_code: m.sap_group_code,
      sap_group_name: m.sap_group_name,
      module_key: m.module_key,
      can_view: m.can_view,
      can_create: m.can_create,
      can_edit: m.can_edit,
      can_delete: m.can_delete,
      can_approve: m.can_approve,
      can_integrate: m.can_integrate,
      can_export: m.can_export,
    };
    let error;
    if (m.id) {
      ({ error } = await supabase
        .from("sap_group_mapping")
        .update(payload)
        .eq("id", m.id));
    } else {
      ({ error } = await supabase
        .from("sap_group_mapping")
        .upsert(payload, {
          onConflict: "company_db,sap_group_code,module_key",
        }));
    }
    if (error) {
      toast.error(`Erro ao salvar: ${error.message}`);
      return;
    }
    toast.success("Mapeamento salvo");
    setEditing(null);
    setCreating(false);
    await refreshMappings();
  }

  async function deleteMapping(id: string) {
    if (!confirm("Excluir este mapeamento?")) return;
    const { error } = await supabase.from("sap_group_mapping").delete().eq("id", id);
    if (error) {
      toast.error(`Erro ao excluir: ${error.message}`);
      return;
    }
    toast.success("Mapeamento removido");
    await refreshMappings();
  }

  function newDraft(): Mapping {
    return {
      id: "",
      company_db: companyDb,
      sap_group_code: groups[0]?.sap_group_code ?? "",
      sap_group_name: groups[0]?.sap_group_name ?? null,
      module_key: ALL_MODULES[0]?.key ?? "",
      can_view: true,
      can_create: false,
      can_edit: false,
      can_delete: false,
      can_approve: false,
      can_integrate: false,
      can_export: false,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={onBack}
          className="p-1 -ml-1 rounded-lg hover:bg-muted"
          aria-label="Voltar"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Building2 className="w-5 h-5 text-cactus-amber" />
        <h3 className="text-lg font-semibold text-foreground">
          Mapeamento SAP × ERP Flow
        </h3>
      </div>
      <p className="text-xs text-muted-foreground px-1">
        Para cada empresa, defina quais ações cada grupo do SAP concede em cada
        módulo. Enquanto uma empresa/módulo não tem mapeamento, o sistema mantém
        o comportamento atual (modo sombra).
      </p>

      <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Select value={companyDb} onValueChange={setCompanyDb}>
            <SelectTrigger className="flex-1">
              <SelectValue
                placeholder={loadingCompanies ? "Carregando..." : "Selecione a empresa"}
              />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.company_db} value={c.company_db}>
                  {c.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncGroups}
            disabled={!companyDb || syncing}
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="ml-1 hidden sm:inline">Sincronizar SAP</span>
          </Button>
        </div>

        {companyDb && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{groups.length} grupos SAP em cache</Badge>
            <Badge variant="secondary">{mappings.length} mapeamentos</Badge>
          </div>
        )}
      </div>

      {companyDb && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar grupo ou módulo..."
                className="pl-9"
              />
            </div>
            <Button
              size="sm"
              onClick={() => setCreating(true)}
              disabled={groups.length === 0}
            >
              <Plus className="w-4 h-4 mr-1" /> Novo
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMappings.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              Nenhum mapeamento. Empresa opera em modo sombra (permissões atuais).
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {filteredMappings.map((m) => {
                const actions = PERMISSION_ACTIONS.filter(
                  (a) => (m as any)[`can_${a}`],
                );
                const moduleLabel =
                  ALL_MODULES.find((x) => x.key === m.module_key)?.label ||
                  m.module_key;
                return (
                  <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {m.sap_group_name || m.sap_group_code}
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {moduleLabel}
                        </span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {actions.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Sem ações
                          </span>
                        ) : (
                          actions.map((a) => (
                            <Badge
                              key={a}
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0"
                            >
                              {ACTION_LABELS[a]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(m)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMapping(m.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <MappingDialog
        open={!!editing || creating}
        initial={editing || (creating ? newDraft() : null)}
        groups={groups}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={saveMapping}
      />
    </div>
  );
}

function MappingDialog({
  open,
  initial,
  groups,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Mapping | null;
  groups: SapGroup[];
  onClose: () => void;
  onSave: (m: Mapping) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Mapping | null>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  if (!draft) return null;

  const setAction = (a: PermissionAction, v: boolean) =>
    setDraft({ ...draft, [`can_${a}`]: v } as Mapping);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {draft.id ? "Editar mapeamento" : "Novo mapeamento"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Grupo SAP</label>
            <Select
              value={draft.sap_group_code}
              onValueChange={(v) => {
                const g = groups.find((x) => x.sap_group_code === v);
                setDraft({
                  ...draft,
                  sap_group_code: v,
                  sap_group_name: g?.sap_group_name ?? null,
                });
              }}
              disabled={!!draft.id}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o grupo SAP" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.sap_group_code} value={g.sap_group_code}>
                    {g.sap_group_name || g.sap_group_code} ({g.sap_group_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Módulo</label>
            <Select
              value={draft.module_key}
              onValueChange={(v) => setDraft({ ...draft, module_key: v })}
              disabled={!!draft.id}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o módulo" />
              </SelectTrigger>
              <SelectContent>
                {ALL_MODULES.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Ações permitidas</p>
            {PERMISSION_ACTIONS.map((a) => (
              <label
                key={a}
                className="flex items-center justify-between py-1.5 cursor-pointer"
              >
                <span className="text-sm">{ACTION_LABELS[a]}</span>
                <Switch
                  checked={(draft as any)[`can_${a}`]}
                  onCheckedChange={(v) => setAction(a, v)}
                />
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={async () => {
              if (!draft.sap_group_code || !draft.module_key) {
                toast.error("Selecione grupo e módulo");
                return;
              }
              setSaving(true);
              await onSave(draft);
              setSaving(false);
            }}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-1" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
