import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";

export interface Notification {
  id: string;
  user_identifier: string;
  company_db: string | null;
  title: string;
  body: string | null;
  category: string;
  is_read: boolean;
  link: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationPreference {
  id: string;
  user_identifier: string;
  category: string;
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
  slack: boolean;
}

export const NOTIFICATION_CATEGORIES = [
  { key: "approval", label: "Aprovações" },
  { key: "expense", label: "Despesas" },
  { key: "integration", label: "Integrações / Synapse" },
  { key: "system", label: "Sistema" },
  { key: "credential", label: "Credenciais" },
] as const;

export function useNotifications() {
  const { session } = useSap();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Notification[]>([]);
  const [approvedForRequester, setApprovedForRequester] = useState<Notification[]>([]);
  const [dismissedPendingIds, setDismissedPendingIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("notifications_dismissed_pending_v1");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  const [dismissedApprovedIds, setDismissedApprovedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("notifications_dismissed_approved_v1");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  const [loading, setLoading] = useState(true);
  const identifier = session?.userName?.toLowerCase() || "";
  const companyDB = session?.companyDB || "";

  const approverVariants = useCallback((): string[] => {
    const id = identifier.trim();
    if (!id) return [];
    // "santiago.macedo" (login SAP) ↔ "Santiago Macedo" (approver_name nos ERPs)
    // Cobrimos dot→space, underscore→space, dash→space e a versão original.
    const variants = new Set<string>();
    variants.add(id);
    variants.add(id.replace(/[._-]+/g, " "));
    variants.add(id.replace(/\s+/g, "."));
    return Array.from(variants).filter(Boolean);
  }, [identifier]);

  const persistDismissed = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem("notifications_dismissed_pending_v1", JSON.stringify(Array.from(next)));
    } catch { /* quota — ignore */ }
  }, []);

  const persistDismissedApproved = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem("notifications_dismissed_approved_v1", JSON.stringify(Array.from(next)));
    } catch { /* quota — ignore */ }
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!identifier) return;
    setLoading(true);
    const variants = approverVariants();
    const emailLower = (session?.userName || "").toLowerCase();
    const [notifRes, expRes, approvedRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_identifier", identifier)
        .order("created_at", { ascending: false })
        .limit(50),
      (async () => {
        if (variants.length === 0) return { data: [] as Array<Record<string, unknown>> };
        // ilike sem wildcards = igualdade case-insensitive.
        const orClauses = variants.map((v) => `current_approver.ilike.${v.replace(/,/g, "")}`).join(",");
        let q = supabase
          .from("expenses")
          .select("id, doc_type, supplier_name, requester_name, total_amount, currency, created_at, current_approver, company_db, cost_center")
          .eq("status", "pendente_aprovacao")
          .or(orClauses)
          .order("created_at", { ascending: false })
          .limit(50);
        if (companyDB) q = q.eq("company_db", companyDB);
        const { data } = await q;
        return { data: (data as Array<Record<string, unknown>>) || [] };
      })(),
      (async () => {
        if (variants.length === 0 && !emailLower) return { data: [] as Array<Record<string, unknown>> };
        // Casa por requester_name (variantes) OU por email do criador/solicitante.
        const clauses: string[] = [];
        for (const v of variants) clauses.push(`requester_name.ilike.${v.replace(/,/g, "")}`);
        if (emailLower) {
          clauses.push(`created_by_email.ilike.${emailLower.replace(/,/g, "")}`);
          clauses.push(`requester_email.ilike.${emailLower.replace(/,/g, "")}`);
        }
        let q = supabase
          .from("expenses")
          .select("id, doc_type, supplier_name, requester_name, total_amount, currency, created_at, updated_at, company_db, cost_center")
          .eq("status", "aprovado")
          .or(clauses.join(","))
          .order("updated_at", { ascending: false })
          .limit(30);
        if (companyDB) q = q.eq("company_db", companyDB);
        const { data } = await q;
        return { data: (data as Array<Record<string, unknown>>) || [] };
      })(),
    ]);

    setNotifications((notifRes.data as Notification[]) || []);

    // Constrói notificações virtuais para as aprovações pendentes que ainda
    // não foram "dispensadas" pelo usuário. Assim o sininho reflete o estado
    // real (inclui aprovações antigas cujo registro em `notifications` foi
    // criado com um user_identifier que não bate com o login atual).
    const virtual: Notification[] = (expRes.data || [])
      .filter((e) => !dismissedPendingIds.has(String(e.id)))
      .map((e) => ({
        id: `pending:${e.id}`,
        user_identifier: identifier,
        company_db: (e.company_db as string) || null,
        title: "Aprovação pendente",
        body: `${(e.doc_type as string) || "Documento"} · ${(e.supplier_name as string) || (e.requester_name as string) || ""} — ${(e.currency as string) || "BRL"} ${Number(e.total_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        category: "approval",
        is_read: false,
        link: "/aprovacoes",
        metadata: { expense_id: e.id, virtual: true, cost_center: e.cost_center },
        created_at: (e.created_at as string) || new Date().toISOString(),
      }));
    setPendingApprovals(virtual);

    const approved: Notification[] = (approvedRes.data || [])
      .filter((e) => !dismissedApprovedIds.has(String(e.id)))
      .map((e) => ({
        id: `approved:${e.id}`,
        user_identifier: identifier,
        company_db: (e.company_db as string) || null,
        title: "Solicitação aprovada",
        body: `${(e.doc_type as string) || "Documento"} · ${(e.supplier_name as string) || ""} — ${(e.currency as string) || "BRL"} ${Number(e.total_amount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} foi aprovada.`,
        category: "approval",
        is_read: false,
        link: "/despesas",
        metadata: { expense_id: e.id, virtual: true, kind: "approved", cost_center: e.cost_center },
        created_at: (e.updated_at as string) || (e.created_at as string) || new Date().toISOString(),
      }));
    setApprovedForRequester(approved);
    setLoading(false);
  }, [identifier, companyDB, approverVariants, dismissedPendingIds, dismissedApprovedIds, session?.userName]);


  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime — notificações reais + mudanças em expenses (para refletir novos
  // pendentes ou aprovações resolvidas).
  useEffect(() => {
    if (!identifier) return;
    const channel = supabase
      .channel(`notifications-realtime-${Math.random().toString(36).slice(2, 10)}`)

      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const newNotif = payload.new as Notification;
          if (newNotif.user_identifier === identifier) {
            setNotifications((prev) => [newNotif, ...prev].slice(0, 50));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses" },
        () => { fetchNotifications(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [identifier, fetchNotifications]);

  // Merge: pendentes virtuais no topo, deduplicadas contra notificações reais
  // que já referenciam o mesmo expense_id (evita duplo-badge).
  const merged: Notification[] = (() => {
    const realExpenseIds = new Set(
      notifications
        .filter((n) => n.category === "approval")
        .map((n) => (n.metadata as { expense_id?: string } | null)?.expense_id)
        .filter(Boolean) as string[]
    );
    const filteredPending = pendingApprovals.filter((v) => {
      const eid = (v.metadata as { expense_id?: string } | null)?.expense_id;
      return !eid || !realExpenseIds.has(eid);
    });
    const filteredApproved = approvedForRequester.filter((v) => {
      const eid = (v.metadata as { expense_id?: string } | null)?.expense_id;
      return !eid || !realExpenseIds.has(eid);
    });
    return [...filteredPending, ...filteredApproved, ...notifications].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  })();

  const unreadCount = merged.filter((n) => !n.is_read).length;

  const markAsRead = useCallback(async (id: string) => {
    if (id.startsWith("pending:")) {
      const expenseId = id.slice("pending:".length);
      setDismissedPendingIds((prev) => {
        const next = new Set(prev);
        next.add(expenseId);
        persistDismissed(next);
        return next;
      });
      setPendingApprovals((prev) => prev.filter((n) => n.id !== id));
      return;
    }
    if (id.startsWith("approved:")) {
      const expenseId = id.slice("approved:".length);
      setDismissedApprovedIds((prev) => {
        const next = new Set(prev);
        next.add(expenseId);
        persistDismissedApproved(next);
        return next;
      });
      setApprovedForRequester((prev) => prev.filter((n) => n.id !== id));
      return;
    }
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }, [persistDismissed, persistDismissedApproved]);

  const markAllAsRead = useCallback(async () => {
    if (!identifier) return;
    // Dispensa todas as pendentes virtuais também.
    if (pendingApprovals.length > 0) {
      setDismissedPendingIds((prev) => {
        const next = new Set(prev);
        for (const p of pendingApprovals) {
          const eid = (p.metadata as { expense_id?: string } | null)?.expense_id;
          if (eid) next.add(eid);
        }
        persistDismissed(next);
        return next;
      });
      setPendingApprovals([]);
    }
    if (approvedForRequester.length > 0) {
      setDismissedApprovedIds((prev) => {
        const next = new Set(prev);
        for (const p of approvedForRequester) {
          const eid = (p.metadata as { expense_id?: string } | null)?.expense_id;
          if (eid) next.add(eid);
        }
        persistDismissedApproved(next);
        return next;
      });
      setApprovedForRequester([]);
    }
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_identifier", identifier)
      .eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, [identifier, pendingApprovals, approvedForRequester, persistDismissed, persistDismissedApproved]);



  return { notifications: merged, loading, unreadCount, markAsRead, markAllAsRead, refresh: fetchNotifications };
}

export function useNotificationPreferences() {
  const { session } = useSap();
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const identifier = session?.userName?.toLowerCase() || "";

  const fetchPreferences = useCallback(async () => {
    if (!identifier) return;
    setLoading(true);
    const { data } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_identifier", identifier);
    setPreferences((data as NotificationPreference[]) || []);
    setLoading(false);
  }, [identifier]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const updatePreference = useCallback(
    async (category: string, field: "in_app" | "email" | "whatsapp" | "slack", value: boolean) => {
      if (!identifier) return;
      const row: Record<string, unknown> = {
        user_identifier: identifier,
        category,
        [field]: value,
      };
      await supabase.from("notification_preferences").upsert(
        row as never,
        { onConflict: "user_identifier,category" }
      );
      await fetchPreferences();
    },
    [identifier, fetchPreferences]
  );

  const getPreference = useCallback(
    (category: string) => {
      return preferences.find((p) => p.category === category) || {
        in_app: true,
        email: false,
        whatsapp: true,
        slack: false,
        category,
        user_identifier: identifier,
        id: "",
      };
    },
    [preferences, identifier]
  );

  return { preferences, loading, updatePreference, getPreference, refresh: fetchPreferences };
}
