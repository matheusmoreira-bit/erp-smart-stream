import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Settings, Check, CheckCheck } from "lucide-react";
import { useNotifications, useNotificationPreferences, NOTIFICATION_CATEGORIES } from "@/hooks/useNotifications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const categoryIcon: Record<string, string> = {
  approval: "📋",
  expense: "💰",
  integration: "⚡",
  system: "🔔",
  credential: "🔑",
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead, loading } = useNotifications();
  const { getPreference, updatePreference, loading: prefLoading } = useNotificationPreferences();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const filtered = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Notificações</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        <Tabs defaultValue="notifications">
          <TabsList className="mb-6">
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="w-4 h-4" /> Notificações
              {unreadCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                  {unreadCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-2">
              <Settings className="w-4 h-4" /> Preferências
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notifications">
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-2">
                <Button
                  variant={filter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter("all")}
                >
                  Todas
                </Button>
                <Button
                  variant={filter === "unread" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter("unread")}
                >
                  Não lidas ({unreadCount})
                </Button>
              </div>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={markAllAsRead} className="gap-1">
                  <CheckCheck className="w-4 h-4" /> Marcar todas como lidas
                </Button>
              )}
            </div>

            <ScrollArea className="h-[calc(100vh-280px)]">
              {loading ? (
                <div className="text-center py-12 text-muted-foreground">Carregando...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {filter === "unread" ? "Nenhuma notificação não lida" : "Nenhuma notificação"}
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((notif) => (
                    <button
                      key={notif.id}
                      className={`w-full text-left px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors flex gap-3 ${
                        !notif.is_read ? "bg-primary/5 border border-primary/10" : ""
                      }`}
                      onClick={() => {
                        if (!notif.is_read) markAsRead(notif.id);
                        if (notif.link) navigate(notif.link);
                      }}
                    >
                      <span className="text-lg mt-0.5">{categoryIcon[notif.category] || "🔔"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm ${!notif.is_read ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                            {notif.title}
                          </p>
                          {!notif.is_read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                        </div>
                        {notif.body && <p className="text-xs text-muted-foreground mt-0.5">{notif.body}</p>}
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: ptBR })}
                        </p>
                      </div>
                      {!notif.is_read && (
                        <button
                          className="p-1.5 rounded hover:bg-muted self-center"
                          onClick={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
                          title="Marcar como lida"
                        >
                          <Check className="w-4 h-4 text-muted-foreground" />
                        </button>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="preferences">
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-foreground mb-1">Preferências de Notificação</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Escolha como e quais tipos de notificação deseja receber.
              </p>

              <div className="space-y-0 divide-y divide-border">
                <div className="grid grid-cols-[1fr_70px_70px_80px_70px] gap-3 pb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Categoria</span>
                  <span className="text-center">In-App</span>
                  <span className="text-center">E-mail</span>
                  <span className="text-center">WhatsApp</span>
                  <span className="text-center">Slack</span>
                </div>
                {NOTIFICATION_CATEGORIES.map((cat) => {
                  const pref = getPreference(cat.key);
                  return (
                    <div key={cat.key} className="grid grid-cols-[1fr_70px_70px_80px_70px] gap-3 py-4 items-center">
                      <div className="flex items-center gap-2">
                        <span>{categoryIcon[cat.key] || "🔔"}</span>
                        <span className="text-sm font-medium text-foreground">{cat.label}</span>
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={pref.in_app}
                          onCheckedChange={(val) => updatePreference(cat.key, "in_app", val)}
                          disabled={prefLoading}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={pref.email}
                          onCheckedChange={(val) => updatePreference(cat.key, "email", val)}
                          disabled={prefLoading}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={pref.whatsapp}
                          onCheckedChange={(val) => updatePreference(cat.key, "whatsapp", val)}
                          disabled={prefLoading}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Switch
                          checked={pref.slack}
                          onCheckedChange={(val) => updatePreference(cat.key, "slack", val)}
                          disabled={prefLoading}
                        />
                      </div>
                    </div>
                r);
                })}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
