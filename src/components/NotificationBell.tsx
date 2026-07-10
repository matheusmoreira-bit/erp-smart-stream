import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const categoryIcon: Record<string, string> = {
    approval: "📋",
    expense: "💰",
    integration: "⚡",
    system: "🔔",
    credential: "🔑",
  };

  const trigger = (
    <button className="relative p-2 rounded-lg hover:bg-muted transition-colors min-h-11 min-w-11 flex items-center justify-center">
      <Bell className="w-5 h-5 text-muted-foreground" />
      {unreadCount > 0 && (
        <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );

  const header = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <h4 className="text-sm font-semibold text-foreground">Notificações</h4>
      <div className="flex gap-2">
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" className="text-xs h-8" onClick={markAllAsRead}>
            Marcar lidas
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-8"
          onClick={() => {
            setOpen(false);
            navigate("/notificacoes");
          }}
        >
          Ver todas
        </Button>
      </div>
    </div>
  );

  const list = (
    <>
      {notifications.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma notificação</div>
      ) : (
        notifications.slice(0, 20).map((notif) => (
          <button
            key={notif.id}
            className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/50 active:bg-muted transition-colors ${
              !notif.is_read ? "bg-primary/5" : ""
            }`}
            onClick={() => {
              if (!notif.is_read) markAsRead(notif.id);
              setOpen(false);
              if (notif.link) navigate(notif.link);
            }}
          >
            <div className="flex gap-3">
              <span className="text-base mt-0.5">
                {(notif.metadata as { kind?: string } | null)?.kind === "approved"
                  ? "✅"
                  : categoryIcon[notif.category] || "🔔"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${!notif.is_read ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                    {notif.title}
                  </p>
                  {!notif.is_read && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                </div>
                {notif.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>}
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: ptBR })}
                </p>
              </div>
            </div>
          </button>
        ))
      )}
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <button
          onClick={() => setOpen(true)}
          className="relative p-2 rounded-lg hover:bg-muted transition-colors min-h-11 min-w-11 flex items-center justify-center"
        >
          <Bell className="w-5 h-5 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <SheetContent side="bottom" className="p-0 h-[85dvh] rounded-t-2xl flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Notificações</SheetTitle>
          </SheetHeader>
          <div className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          {header}
          <div className="flex-1 overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.5rem)]">{list}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        {header}
        <ScrollArea className="max-h-80">{list}</ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
