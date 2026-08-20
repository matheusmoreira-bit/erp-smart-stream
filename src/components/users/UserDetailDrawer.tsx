import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldAlert, ExternalLink, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logAuditAction } from "@/hooks/useAuditLog";
import { canonicalUserKey } from "@/lib/user-identity";
import type { SapUser } from "@/lib/cache-repository";
import type { PermissionGroupOption } from "@/hooks/useUserGroupAdmin";
import {
  MANAGEMENT_SEGMENT_LABEL,
  segmentsForCompany,
  type ManagementSegment,
} from "@/hooks/useManagementSegments";
import { IDP_STATE_LABEL, type IdpLinkState, type UserAlert } from "@/lib/user-state";

export interface UserDrawerData {
  user: SapUser;
  segment: ManagementSegment;
  groupId: string | null;
  groupName: string | null;
  idp: IdpLinkState;
  isAdmin: boolean;
  hasLicense: boolean;
  licenseType: string | null;
  phone?: string;
  lastLogin: string | null;
  alerts: UserAlert[];
}

interface Props {
  data: UserDrawerData | null;
  companyDb: string | null | undefined;
  groups: PermissionGroupOption[];
  onClose: () => void;
  onSetSegment: (identity: string, segment: ManagementSegment) => Promise<void>;
  onSetGroup: (opts: { userCode: string; email?: string | null; groupId: string | null; companyDb?: string | null }) => Promise<void>;
  onToggleLock: (user: SapUser) => Promise<void>;
  onResetPassword: (user: SapUser) => void;
  onEditPhone: (user: SapUser) => void;
  onChanged: () => void;
}

type PendingChange =
  | { kind: "segment"; value: ManagementSegment }
  | { kind: "group"; value: string | null }
  | { kind: "lock" }
  | null;

function fmt(value: string | null): string {
  if (!value) return "Sem registro";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function UserDetailDrawer({
  data,
  companyDb,
  groups,
  onClose,
  onSetSegment,
  onSetGroup,
  onToggleLock,
  onResetPassword,
  onEditPhone,
  onChanged,
}: Props) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingChange>(null);
  const [saving, setSaving] = useState(false);
  const [timeline, setTimeline] = useState<{ created_at: string; action: string; entity_type: string }[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [hasLicense, setHasLicense] = useState(false);

  useEffect(() => {
    setHasLicense(!!data?.hasLicense);
  }, [data?.hasLicense]);

  const email = data?.user.eMail ?? null;

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setTimelineLoading(true);
    supabase
      .from("audit_log")
      .select("created_at, action, entity_type")
      .ilike("actor_email", email ? email : `%${data.user.UserCode}%`)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data: rows }) => {
        if (cancelled) return;
        setTimeline(rows || []);
        setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data, email]);

  const segments = useMemo(() => segmentsForCompany(companyDb), [companyDb]);

  const applyPending = useCallback(async () => {
    if (!data || !pending) return;
    setSaving(true);
    const identity = data.user.UserCode || data.user.eMail || "";
    try {
      if (pending.kind === "segment") {
        await onSetSegment(identity, pending.value);
        await logAuditAction({
          action: "user_management_segment_changed",
          entity_type: "user",
          entity_id: identity,
          company_db: companyDb || undefined,
          details: { from: data.segment, to: pending.value },
        });
        toast.success(`Gestão alterada para ${MANAGEMENT_SEGMENT_LABEL[pending.value]}`);
      } else if (pending.kind === "group") {
        await onSetGroup({ userCode: data.user.UserCode, email: data.user.eMail, groupId: pending.value, companyDb: companyDb || null });
        await logAuditAction({
          action: "user_permission_group_changed",
          entity_type: "user",
          entity_id: identity,
          details: { from: data.groupName, to: groups.find((g) => g.id === pending.value)?.name ?? null },
        });
        toast.success(companyDb ? "Grupo de permissão atualizado nesta empresa" : "Grupo de permissão atualizado");
      } else {
        await onToggleLock(data.user);
        await logAuditAction({
          action: data.user.Locked === "tYES" ? "user_unblocked" : "user_blocked",
          entity_type: "user",
          entity_id: identity,
          company_db: companyDb || undefined,
        });
        toast.success(data.user.Locked === "tYES" ? "Acesso desbloqueado" : "Acesso bloqueado");
      }
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível aplicar a alteração");
    } finally {
      setSaving(false);
      setPending(null);
    }
  }, [data, pending, onSetSegment, onSetGroup, onToggleLock, onChanged, companyDb, groups]);

  const toggleLicense = async (next: boolean) => {
    if (!data || !companyDb) return;
    setLicenseSaving(true);
    try {
      const { error } = await supabase.from("user_licenses").upsert(
        [
          {
            company_db: companyDb,
            user_code: data.user.UserCode,
            user_name: data.user.UserName,
            has_license: next,
            is_locked: data.user.Locked === "tYES",
          },
        ],
        { onConflict: "company_db,user_code" },
      );
      if (error) throw new Error(error.message);
      setHasLicense(next);
      await logAuditAction({
        action: next ? "user_license_granted" : "user_license_revoked",
        entity_type: "user",
        entity_id: data.user.UserCode,
        company_db: companyDb,
      });
      toast.success(next ? "Licença atribuída" : "Licença removida");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar licença");
    } finally {
      setLicenseSaving(false);
    }
  };

  if (!data) return null;
  const isLocked = data.user.Locked === "tYES";

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="truncate">{data.user.UserName || data.user.UserCode}</SheetTitle>
            <SheetDescription className="truncate">
              {data.user.UserCode} · {data.user.eMail || "Sem e-mail"}
            </SheetDescription>
          </SheetHeader>

          {data.alerts.length > 0 && (
            <div className="mt-4 space-y-2">
              {data.alerts.map((a) => (
                <div
                  key={a.key}
                  className={`flex gap-2 rounded-lg border p-3 text-xs ${
                    a.severity === "critical"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-warning/40 bg-warning/10 text-warning"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="font-semibold">{a.label}</p>
                    <p className="opacity-80">{a.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Tabs defaultValue="acesso" className="mt-4">
            <TabsList className="w-full grid grid-cols-6">
              <TabsTrigger value="identidade">Identidade</TabsTrigger>
              <TabsTrigger value="acesso">Acesso</TabsTrigger>
              <TabsTrigger value="empresas">Empresas</TabsTrigger>
              <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
              <TabsTrigger value="licenca">Licença</TabsTrigger>
              <TabsTrigger value="atividade">Atividade</TabsTrigger>
            </TabsList>


            <TabsContent value="identidade" className="space-y-3 pt-4 text-sm">
              <Field label="Nome" value={data.user.UserName || "—"} />
              <Field label="Username" value={data.user.UserCode || "—"} />
              <Field label="E-mail" value={data.user.eMail || "—"} />
              <Field label="Telefone" value={data.phone || "Sem telefone"} />
              <Field label="Chave canônica" value={canonicalUserKey(data.user.UserCode || data.user.eMail) || "—"} />
              <Button variant="outline" size="sm" onClick={() => onEditPhone(data.user)}>
                Editar telefone
              </Button>
            </TabsContent>

            <TabsContent value="acesso" className="space-y-5 pt-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Gestão</Label>
                <Select
                  value={data.segment}
                  onValueChange={(v) => setPending({ kind: "segment", value: v as ManagementSegment })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {segments.map((s) => (
                      <SelectItem key={s} value={s}>{MANAGEMENT_SEGMENT_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A gestão define o escopo de projetos visíveis nesta empresa.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Grupo de permissão</Label>
                <Select
                  value={data.groupId ?? "none"}
                  onValueChange={(v) => setPending({ kind: "group", value: v === "none" ? null : v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem grupo</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}{g.company_db ? ` · ${g.company_db}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  A permissão define se o usuário pode entrar nesta empresa e quais módulos enxerga.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Acesso ERP Flow</p>
                  <p className="text-xs text-muted-foreground">
                    {isLocked ? "Bloqueado" : "Ativo"} · aplicado imediatamente no ERP
                  </p>
                </div>
                <Switch checked={!isLocked} onCheckedChange={() => setPending({ kind: "lock" })} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Admin backoffice</p>
                  <p className="text-xs text-muted-foreground">
                    {data.isAdmin ? "Este usuário é administrador do backoffice." : "Sem acesso administrativo."}
                  </p>
                </div>
                <Badge variant={data.isAdmin ? "secondary" : "outline"}>{data.isAdmin ? "Sim" : "Não"}</Badge>
              </div>

              <Button variant="outline" size="sm" onClick={() => onResetPassword(data.user)}>
                Redefinir senha
              </Button>
            </TabsContent>

            <TabsContent value="empresas" className="pt-4">
              <UserCompaniesTab
                userCode={data.user.UserCode}
                userName={data.user.UserName || data.user.UserCode}
                email={data.user.eMail}
                sourceCompanyDb={companyDb}
                onChanged={onChanged}
              />
            </TabsContent>

            <TabsContent value="vinculos" className="space-y-4 pt-4 text-sm">

              <div className="rounded-lg border border-border p-3 space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">SAP</p>
                <p className="text-foreground">
                  {companyDb || "—"} · código <span className="font-mono">{data.user.UserCode}</span>
                </p>
                <Badge variant={isLocked ? "destructive" : "secondary"} className="mt-1">
                  {isLocked ? "Bloqueado no SAP" : "Vinculado"}
                </Badge>
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Identidade (IdP)</p>
                <Badge
                  variant={data.idp === "linked" ? "secondary" : "destructive"}
                >
                  {IDP_STATE_LABEL[data.idp]}
                </Badge>
                {data.idp !== "linked" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate(`/usuarios/sincronizacao-idp?user=${encodeURIComponent(data.user.UserCode)}`)}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />
                    Resolver em Sincronização IdP
                  </Button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="licenca" className="space-y-3 pt-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Licença atribuída</p>
                  <p className="text-xs text-muted-foreground">{data.licenseType || "Tipo não definido"}</p>
                </div>
                {licenseSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <Switch checked={hasLicense} onCheckedChange={toggleLicense} disabled={!companyDb} />
                )}
              </div>
            </TabsContent>

            <TabsContent value="atividade" className="space-y-2 pt-4">
              <p className="text-xs text-muted-foreground">Último login (ERP Flow): {fmt(data.lastLogin)}</p>
              {timelineLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Sem eventos registrados.</p>
              ) : (
                <ul className="space-y-2">
                  {timeline.map((t, i) => (
                    <li key={i} className="rounded-md border border-border p-2 text-xs">
                      <span className="font-medium text-foreground">{t.action}</span>
                      <span className="text-muted-foreground"> · {t.entity_type} · {fmt(t.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="outline" size="sm" onClick={() => navigate("/usuarios/atividade")}>
                Ver atividade completa
              </Button>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warning" />
              Confirmar alteração de alto impacto
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "segment" &&
                `A gestão de ${data.user.UserName || data.user.UserCode} passará para ${MANAGEMENT_SEGMENT_LABEL[pending.value]}, alterando o escopo de projetos visíveis.`}
              {pending?.kind === "group" &&
                `O grupo de permissão passará para "${groups.find((g) => g.id === pending.value)?.name ?? "Sem grupo"}" nesta empresa.`}
              {pending?.kind === "lock" &&
                (isLocked
                  ? "O acesso do usuário será desbloqueado no ERP."
                  : "O acesso do usuário será bloqueado no ERP imediatamente.")}
              {" "}A alteração é registrada em auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); applyPending(); }} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-foreground break-all">{value}</p>
    </div>
  );
}
