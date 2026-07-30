import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  History,
  Loader2,
  RotateCcw,
  Save,
  GitCompareArrows,
  Plus,
  Minus,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useApprovalMatrixVersions } from "@/hooks/useApprovalMatrixVersions";
import {
  buildSnapshot,
  describeRule,
  diffSnapshots,
  summarizeDiff,
  type MatrixVersion,
} from "@/lib/approval-matrix-versions";
import type { ApprovalRule } from "@/hooks/useApprovalRules";

interface Props {
  open: boolean;
  onClose: () => void;
  rules: ApprovalRule[];
  isAdmin: boolean;
  /** Recarrega as regras vivas após um rollback. */
  onRestored: () => void | Promise<void>;
}

const CURRENT = "__current__";

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString("pt-BR");
  } catch {
    return dt;
  }
}

export function ApprovalMatrixVersionsDialog({ open, onClose, rules, isAdmin, onRestored }: Props) {
  const { versions, isLoading, publishVersion, restoreVersion } = useApprovalMatrixVersions();
  const [tab, setTab] = useState<"history" | "compare">("history");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState<MatrixVersion | null>(null);
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>(CURRENT);

  const currentSnapshot = useMemo(() => buildSnapshot(rules), [rules]);

  const snapshotOf = (id: string) =>
    id === CURRENT ? currentSnapshot : versions.find((v) => v.id === id)?.snapshot || [];

  const diffs = useMemo(() => {
    if (!leftId || !rightId) return [];
    return diffSnapshots(snapshotOf(leftId), snapshotOf(rightId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId, rightId, versions, currentSnapshot]);

  const summary = useMemo(() => summarizeDiff(diffs), [diffs]);

  const latest = versions[0];
  const pendingChanges = useMemo(() => {
    if (!latest) return currentSnapshot.length > 0;
    return summarizeDiff(diffSnapshots(latest.snapshot, currentSnapshot)).changed > 0 ||
      summarizeDiff(diffSnapshots(latest.snapshot, currentSnapshot)).added > 0 ||
      summarizeDiff(diffSnapshots(latest.snapshot, currentSnapshot)).removed > 0;
  }, [latest, currentSnapshot]);

  const handlePublish = async () => {
    setBusy(true);
    try {
      const v = await publishVersion(rules, { label, description });
      toast.success(`Versão v${v.version_no} publicada`);
      setLabel("");
      setDescription("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao publicar versão");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!confirmVersion) return;
    setBusy(true);
    try {
      await restoreVersion(confirmVersion, rules);
      toast.success(`Matriz restaurada para v${confirmVersion.version_no}`);
      setConfirmVersion(null);
      await onRestored();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao restaurar versão");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Versionamento da matriz de alçadas
            </DialogTitle>
            <DialogDescription>
              Guarde cada publicação da matriz, compare versões e volte a um estado anterior.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid grid-cols-2 w-full sm:w-[420px]">
              <TabsTrigger value="history" className="gap-1.5">
                <History className="w-3.5 h-3.5" /> Histórico
              </TabsTrigger>
              <TabsTrigger value="compare" className="gap-1.5">
                <GitCompareArrows className="w-3.5 h-3.5" /> Comparar
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "history" ? (
            <div className="flex-1 overflow-hidden flex flex-col gap-4">
              {isAdmin && (
                <div className="glass-card p-3 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Save className="w-4 h-4 text-primary" /> Publicar estado atual
                    <span className="text-xs text-muted-foreground font-normal">
                      ({currentSnapshot.length} regras)
                    </span>
                    {pendingChanges && (
                      <Badge variant="outline" className="text-warning border-warning/40">
                        alterações não publicadas
                      </Badge>
                    )}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder="Rótulo da versão (ex.: Matriz 2026 Q3)"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      className="h-9 text-sm"
                    />
                    <Button onClick={handlePublish} disabled={busy} className="gap-1.5 shrink-0">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Publicar versão
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Descrição/justificativa (opcional)"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="text-sm min-h-[56px]"
                  />
                </div>
              )}

              <ScrollArea className="flex-1 pr-3">
                {isLoading ? (
                  <div className="py-10 text-center text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando versões...
                  </div>
                ) : versions.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma versão publicada ainda.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((v) => (
                      <div key={v.id} className="glass-card p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">
                              v{v.version_no}
                            </span>
                            {v.label || "Sem rótulo"}
                            {v.restored_from_version != null && (
                              <Badge variant="outline" className="text-xs">
                                rollback de v{v.restored_from_version}
                              </Badge>
                            )}
                          </p>
                          {v.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{v.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1 font-mono">
                            {fmt(v.created_at)} · {v.created_by || "—"} · {v.rules_count} regras ·{" "}
                            {v.levels_count} níveis
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => {
                              setLeftId(v.id);
                              setRightId(CURRENT);
                              setTab("compare");
                            }}
                          >
                            <GitCompareArrows className="w-3.5 h-3.5" /> Comparar
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => setConfirmVersion(v)}
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-2 items-center">
                <Select value={leftId} onValueChange={setLeftId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Versão base" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_no} — {v.label || fmt(v.created_at)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <GitCompareArrows className="w-4 h-4 text-muted-foreground shrink-0" />
                <Select value={rightId} onValueChange={setRightId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Comparar com" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CURRENT}>Estado atual (não publicado)</SelectItem>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version_no} — {v.label || fmt(v.created_at)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!leftId ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Selecione uma versão base para comparar.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline" className="text-success border-success/40">
                      +{summary.added} incluídas
                    </Badge>
                    <Badge variant="outline" className="text-warning border-warning/40">
                      ~{summary.changed} alteradas
                    </Badge>
                    <Badge variant="outline" className="text-destructive border-destructive/40">
                      -{summary.removed} removidas
                    </Badge>
                    <Badge variant="outline">{summary.unchanged} sem mudança</Badge>
                  </div>
                  <ScrollArea className="flex-1 pr-3">
                    <div className="space-y-2">
                      {diffs
                        .filter((d) => d.kind !== "unchanged")
                        .map((d) => (
                          <div key={`${d.kind}-${d.id}`} className="glass-card p-3">
                            <p className="text-sm font-medium flex items-center gap-1.5">
                              {d.kind === "added" && <Plus className="w-3.5 h-3.5 text-success" />}
                              {d.kind === "removed" && <Minus className="w-3.5 h-3.5 text-destructive" />}
                              {d.kind === "changed" && <Pencil className="w-3.5 h-3.5 text-warning" />}
                              {d.name}
                              {d.fields.length > 0 && (
                                <span className="text-xs text-muted-foreground font-normal">
                                  ({d.fields.join(", ")})
                                </span>
                              )}
                            </p>
                            {d.before && (
                              <p className="text-xs text-muted-foreground font-mono mt-1 break-words">
                                antes: {describeRule(d.before)}
                              </p>
                            )}
                            {d.after && (
                              <p className="text-xs text-foreground/80 font-mono mt-0.5 break-words">
                                depois: {describeRule(d.after)}
                              </p>
                            )}
                          </div>
                        ))}
                      {diffs.filter((d) => d.kind !== "unchanged").length === 0 && (
                        <div className="py-10 text-center text-sm text-muted-foreground">
                          Nenhuma diferença entre as versões selecionadas.
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmVersion} onOpenChange={(o) => !o && setConfirmVersion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restaurar a matriz para v{confirmVersion?.version_no}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              As regras atuais desta empresa serão substituídas pelas{" "}
              {confirmVersion?.rules_count || 0} regras dessa versão. Um backup automático do estado
              atual é publicado antes do rollback e tudo fica registrado na trilha de auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleRestore(); }} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ApprovalMatrixVersionsDialog;
