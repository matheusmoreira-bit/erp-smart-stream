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
  const [loading, setLoading] = useState(true);
  const identifier = session?.userName?.toLowerCase() || "";

  const fetchNotifications = useCallback(async () => {
    if (!identifier) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_identifier", identifier)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications((data as Notification[]) || []);
    setLoading(false);
  }, [identifier]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!identifier) return;
    const channel = supabase
      .channel("notifications-realtime")
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [identifier]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!identifier) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_identifier", identifier)
      .eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, [identifier]);

  return { notifications, loading, unreadCount, markAsRead, markAllAsRead, refresh: fetchNotifications };
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
