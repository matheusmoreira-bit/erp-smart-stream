import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Search,
  Unlink,
  CheckCircle2,
  AlertCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { useSapUsers } from "@/hooks/useSapUsers";
import { useIdpSync, type JumpCloudUser } from "@/hooks/useIdpSync";
import { CachedSearchCombobox } from "@/components/CachedSearchCombobox";
import type { SapSearchOption } from "@/components/SapSearchCombobox";
import { toast } from "sonner";
import { PageTitle } from "@/components/PageTitle";

function jcToOption(jc: JumpCloudUser): SapSearchOption {
  const name = jc.displayname || `${jc.firstname || ""} ${jc.lastname || ""}`.trim() || jc.username;
  return {
    code: jc._id,
    name,
    extra: jc.email,
  };
}

export default function IdpSyncPage() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { users: sapUsers, isLoading: sapLoading } = useSapUsers();
  const {
    jcUsers,
    mappings,
    isLoadingJc,
    isLoadingMappings,
    error,
    fetchJumpCloudUsers,
    fetchMappings,
    autoSync,
    linkManually,
    unlinkUser,
  } = useIdpSync();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "linked" | "pending">("all");
  const [syncing, setSyncing] = useState(false);
  const [linkingUser, setLinkingUser] = useState<string | null>(null);

  useEffect(() => {
    fetchMappings();
    fetchJumpCloudUsers();
  }, [fetchMappings, fetchJumpCloudUsers]);

  // Auto-link only ONCE per mount, only for users WITHOUT an existing mapping entry.
  // To re-link an already-mapped user, the admin must remove the entry first.
  const autoLinkDoneRef = useRef(false);
  useEffect(() => {
    if (autoLinkDoneRef.current) return;
    if (sapLoading || isLoadingJc || isLoadingMappings) return;
    if (sapUsers.length === 0 || jcUsers.length === 0) return;

    autoLinkDoneRef.current = true;

    const activeUsers = sapUsers.filter((u) => u.Locked !== "tYES");
    const mappedCodes = new Set(mappings.map((m) => m.sap_user_code));

    const unmappedWithMatch = activeUsers.filter((sap) => {
      if (mappedCodes.has(sap.UserCode)) return false;
      if (!sap.eMail) return false;
      return jcUsers.some((jc) => jc.email?.toLowerCase() === sap.eMail!.toLowerCase());
    });

    if (unmappedWithMatch.length > 0) {
      autoSync(unmappedWithMatch, jcUsers).catch((e) =>
        console.error("Auto-link error:", e)
      );
    }
  }, [sapUsers, jcUsers, mappings, sapLoading, isLoadingJc, isLoadingMappings, autoSync]);

  const jcOptions = useMemo(() => jcUsers.map(jcToOption), [jcUsers]);

  const handleAutoSync = async () => {
    setSyncing(true);
    try {
      const jcList = await fetchJumpCloudUsers(true); // force refresh
      if (jcList.length === 0) {
        toast.error("Nenhum usuário JumpCloud encontrado. Verifique as credenciais.");
        return;
      }
      const activeUsers = sapUsers.filter((u) => u.Locked !== "tYES");
      const mappedCodes = new Set(mappings.map((m) => m.sap_user_code));
      const toSync = activeUsers.filter((u) => !mappedCodes.has(u.UserCode));
      if (toSync.length === 0) {
        toast.info("Nenhum usuário pendente. Remova o vínculo atual para re-sincronizar.");
        return;
      }
      await autoSync(toSync, jcList);
      toast.success(`Sincronização concluída! ${toSync.length} usuário(s) processado(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na sincronização");
    } finally {
      setSyncing(false);
    }
  };

  const handleRefreshJc = async () => {
    await fetchJumpCloudUsers(true);
    toast.success("Lista JumpCloud atualizada");
  };

  const handleComboSelect = useCallback(
    async (sapUserCode: string, option: SapSearchOption | null) => {
      if (!option) return;
      const jcUser = jcUsers.find((j) => j._id === option.code);
      if (!jcUser) return;
      setLinkingUser(sapUserCode);
      try {
        await linkManually(sapUserCode, jcUser);
        toast.success(`Vinculado a ${jcUser.email}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao vincular");
      } finally {
        setLinkingUser(null);
      }
    },
    [jcUsers, linkManually]
  );

  const handleUnlink = async (sapUserCode: string) => {
    try {
      await unlinkUser(sapUserCode);
      toast.success("Vínculo removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao desvincular");
    }
  };

  // Only active SAP users
  const activeUsers = useMemo(
    () => sapUsers.filter((u) => u.Locked !== "tYES"),
    [sapUsers]
  );

  // Merge SAP users with mappings
  const mergedList = useMemo(() => {
    const mappingMap = new Map(mappings.map((m) => [m.sap_user_code, m]));
    return activeUsers.map((sap) => {
      const mapping = mappingMap.get(sap.UserCode);
      return {
        sapUser: sap,
        mapping,
        status: mapping?.status || "not_synced",
      };
    });
  }, [activeUsers, mappings]);

  const filtered = useMemo(() => {
    let list = mergedList;

    if (statusFilter === "linked") {
      list = list.filter((r) => r.status === "linked");
    } else if (statusFilter === "pending") {
      list = list.filter((r) => r.status !== "linked");
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.sapUser.UserCode.toLowerCase().includes(q) ||
          r.sapUser.UserName?.toLowerCase().includes(q) ||
          r.sapUser.eMail?.toLowerCase().includes(q) ||
          r.mapping?.idp_email?.toLowerCase().includes(q) ||
          r.mapping?.idp_display_name?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [mergedList, search, statusFilter]);

  const stats = useMemo(() => {
    const linked = mergedList.filter((r) => r.status === "linked").length;
    const pending = mergedList.filter((r) => r.status !== "linked").length;
    return { total: mergedList.length, linked, pending };
  }, [mergedList]);

  const isLoading = sapLoading || isLoadingMappings;

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Sincronização IdP" />
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/usuarios/lista")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Sincronização IdP</h1>
              <p className="text-sm text-muted-foreground">
                Vinculação de usuários SAP (ativos) ↔ JumpCloud
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshJc}
              disabled={isLoadingJc}
              className="gap-2"
              title="Atualizar cache JumpCloud"
            >
              {isLoadingJc ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              JumpCloud
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleAutoSync}
              disabled={syncing || sapLoading}
              className="gap-2"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Sincronizar
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {!session && (
          <div className="p-6 rounded-xl border border-border bg-card text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto" />
            <p className="text-foreground font-medium">Sessão SAP não iniciada</p>
            <p className="text-sm text-muted-foreground">
              Faça login no SAP Business One na tela principal para visualizar os usuários.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")} className="mt-2">
              Ir para Login
            </Button>
          </div>
        )}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Usuários Ativos</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-green-500">{stats.linked}</p>
            <p className="text-xs text-muted-foreground">Vinculados</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, código ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-card border-border"
            />
          </div>
          <div className="flex gap-1 border border-border rounded-lg p-0.5 bg-muted/50">
            {(["all", "linked", "pending"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  statusFilter === f
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "Todos" : f === "linked" ? "Vinculados" : "Pendentes"}
              </button>
            ))}
          </div>
        </div>

        {/* User List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Carregando…</span>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-[1fr_1.2fr_auto] items-center px-6 py-3 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Usuário SAP
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                JumpCloud
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-24 text-right">
                Ações
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">Nenhum usuário encontrado</div>
            ) : (
              filtered.map((row) => {
                const isLinked = row.status === "linked" && row.mapping;
                return (
                <div
                  key={row.sapUser.UserCode}
                  className={`grid grid-cols-[1fr_1.2fr_auto] items-center px-6 py-3 border-b border-border last:border-b-0 transition-colors ${
                    isLinked
                      ? "bg-green-500/10 hover:bg-green-500/15 border-l-2 border-l-green-500"
                      : "hover:bg-muted/20"
                  }`}
                >
                  {/* SAP User */}
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">
                      {row.sapUser.UserName || row.sapUser.UserCode}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.sapUser.UserCode} • {row.sapUser.eMail || "Sem e-mail"}
                    </p>
                  </div>

                  {/* JumpCloud - combobox or linked info */}
                  <div className="min-w-0 pr-2">
                    {row.status === "linked" && row.mapping ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">
                            {row.mapping.idp_display_name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {row.mapping.idp_email}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <CachedSearchCombobox
                        options={jcOptions}
                        isLoading={isLoadingJc}
                        value={null}
                        onChange={(opt) => handleComboSelect(row.sapUser.UserCode, opt)}
                        placeholder="Buscar usuário JumpCloud..."
                        suggestedQuery={row.sapUser.eMail || undefined}
                      />
                    )}
                  </div>

                  {/* Actions */}
                  <div className="w-24 flex justify-end">
                    {row.status === "linked" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive h-8 w-8"
                        onClick={() => handleUnlink(row.sapUser.UserCode)}
                        title="Desvincular"
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}
