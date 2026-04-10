import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  Search,
  Link2,
  Unlink,
  CheckCircle2,
  AlertCircle,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSapUsers } from "@/hooks/useSapUsers";
import { useIdpSync, type JumpCloudUser } from "@/hooks/useIdpSync";
import { toast } from "sonner";

export default function IdpSyncPage() {
  const navigate = useNavigate();
  const { users: sapUsers, isLoading: sapLoading } = useSapUsers();
  const {
    mappings,
    isLoadingJc,
    isLoadingMappings,
    isSearching,
    searchResults,
    error,
    fetchJumpCloudUsers,
    fetchMappings,
    autoSync,
    linkManually,
    unlinkUser,
    searchJumpCloud,
    setSearchResults,
  } = useIdpSync();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "linked" | "pending">("all");
  const [syncing, setSyncing] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; sapUserCode: string; sapUserName: string } | null>(null);
  const [jcSearch, setJcSearch] = useState("");

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const handleAutoSync = async () => {
    setSyncing(true);
    try {
      const jcList = await fetchJumpCloudUsers();
      if (jcList.length === 0) {
        toast.error("Nenhum usuário JumpCloud encontrado. Verifique as credenciais.");
        return;
      }
      await autoSync(sapUsers, jcList);
      toast.success(`Sincronização concluída! ${jcList.length} usuários JumpCloud processados.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na sincronização");
    } finally {
      setSyncing(false);
    }
  };

  const handleManualLink = async (jcUser: JumpCloudUser) => {
    if (!linkDialog) return;
    try {
      await linkManually(linkDialog.sapUserCode, jcUser);
      toast.success(`${linkDialog.sapUserName} vinculado a ${jcUser.email}`);
      setLinkDialog(null);
      setSearchResults([]);
      setJcSearch("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao vincular");
    }
  };

  const handleUnlink = async (sapUserCode: string) => {
    try {
      await unlinkUser(sapUserCode);
      toast.success("Vínculo removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao desvincular");
    }
  };

  const handleJcSearch = (value: string) => {
    setJcSearch(value);
    if (value.length >= 2) {
      searchJumpCloud(value);
    } else {
      setSearchResults([]);
    }
  };

  // Merge SAP users with mappings
  const mergedList = useMemo(() => {
    const mappingMap = new Map(mappings.map((m) => [m.sap_user_code, m]));
    return sapUsers.map((sap) => {
      const mapping = mappingMap.get(sap.UserCode);
      return {
        sapUser: sap,
        mapping,
        status: mapping?.status || "not_synced",
      };
    });
  }, [sapUsers, mappings]);

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
      <header className="border-b border-border px-6 py-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/users")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">IdP Sync</h1>
              <p className="text-sm text-muted-foreground">
                Vinculação de usuários SAP ↔ JumpCloud
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total de Usuários</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-success">{stats.linked}</p>
            <p className="text-xs text-muted-foreground">Vinculados</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-warning">{stats.pending}</p>
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
            <div className="grid grid-cols-[1fr_1fr_auto] items-center px-6 py-3 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Usuário SAP
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                JumpCloud
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-28 text-right">
                Ações
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">Nenhum usuário encontrado</div>
            ) : (
              filtered.map((row) => (
                <div
                  key={row.sapUser.UserCode}
                  className="grid grid-cols-[1fr_1fr_auto] items-center px-6 py-3 border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
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

                  {/* JumpCloud */}
                  <div className="min-w-0">
                    {row.status === "linked" && row.mapping ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
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
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
                        <span className="text-sm">Não vinculado</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="w-28 flex justify-end gap-1">
                    {row.status === "linked" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs gap-1 text-muted-foreground hover:text-destructive"
                        onClick={() => handleUnlink(row.sapUser.UserCode)}
                      >
                        <Unlink className="w-3 h-3" />
                        Desvincular
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={() =>
                          setLinkDialog({
                            open: true,
                            sapUserCode: row.sapUser.UserCode,
                            sapUserName: row.sapUser.UserName || row.sapUser.UserCode,
                          })
                        }
                      >
                        <Link2 className="w-3 h-3" />
                        Vincular
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Manual Link Dialog */}
      <Dialog
        open={!!linkDialog?.open}
        onOpenChange={(open) => {
          if (!open) {
            setLinkDialog(null);
            setJcSearch("");
            setSearchResults([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular Usuário JumpCloud</DialogTitle>
            <DialogDescription>
              Busque um usuário JumpCloud para vincular a{" "}
              <strong>{linkDialog?.sapUserName}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou e-mail no JumpCloud..."
                value={jcSearch}
                onChange={(e) => handleJcSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {isSearching && (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto divide-y divide-border rounded-lg border border-border">
                {searchResults.map((jc) => (
                  <div
                    key={jc._id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => handleManualLink(jc)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {jc.displayname || `${jc.firstname || ""} ${jc.lastname || ""}`.trim() || jc.username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{jc.email}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {jc.suspended ? "Suspenso" : "Ativo"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {jcSearch.length >= 2 && !isSearching && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum usuário encontrado
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
