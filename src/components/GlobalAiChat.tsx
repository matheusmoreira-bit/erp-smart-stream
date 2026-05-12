import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

type Msg = { id?: string; role: "user" | "assistant"; content: string };
type Thread = { id: string; title: string; updated_at: string };

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`;

export function GlobalAiChat() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadThreads = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("ai_chat_threads")
      .select("id, title, updated_at").order("updated_at", { ascending: false }).limit(30);
    setThreads(data || []);
  }, [userId]);

  const loadMessages = useCallback(async (tid: string) => {
    const { data } = await supabase.from("ai_chat_messages")
      .select("id, role, content").eq("thread_id", tid).order("created_at", { ascending: true });
    setMessages((data || []).filter((m: any) => m.role === "user" || m.role === "assistant") as Msg[]);
  }, []);

  useEffect(() => { if (open && userId) loadThreads(); }, [open, userId, loadThreads]);
  useEffect(() => { if (activeId) loadMessages(activeId); else setMessages([]); }, [activeId, loadMessages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, loading]);
  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 100); }, [open, activeId]);

  const newThread = async () => {
    if (!userId) return;
    const { data, error } = await supabase.from("ai_chat_threads")
      .insert({ user_id: userId, title: "Nova conversa" }).select("id, title, updated_at").single();
    if (error) { toast.error("Erro ao criar conversa"); return; }
    setThreads((p) => [data as Thread, ...p]);
    setActiveId(data.id);
    setMessages([]);
  };

  const deleteThread = async (id: string) => {
    await supabase.from("ai_chat_threads").delete().eq("id", id);
    setThreads((p) => p.filter((t) => t.id !== id));
    if (activeId === id) { setActiveId(null); setMessages([]); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !userId) return;

    let tid = activeId;
    if (!tid) {
      const { data, error } = await supabase.from("ai_chat_threads")
        .insert({ user_id: userId, title: text.slice(0, 60) }).select("id, title, updated_at").single();
      if (error) { toast.error("Erro ao iniciar conversa"); return; }
      tid = data.id;
      setActiveId(tid);
      setThreads((p) => [data as Thread, ...p]);
    } else {
      // update title if first message
      if (messages.length === 0) {
        await supabase.from("ai_chat_threads").update({ title: text.slice(0, 60) }).eq("id", tid);
        setThreads((p) => p.map((t) => t.id === tid ? { ...t, title: text.slice(0, 60) } : t));
      }
    }

    const newMsgs: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: newMsgs.map(({ role, content }) => ({ role, content })), threadId: tid }),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || `Erro ${resp.status}`);
      setMessages((p) => [...p, { role: "assistant", content: j.content || "" }]);
      loadThreads();
    } catch (e) {
      setMessages((p) => [...p, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Erro"}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (!userId) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        aria-label="Assistente IA"
        className="fixed bottom-6 right-6 z-40 rounded-full h-14 w-14 p-0 shadow-lg bg-gradient-to-br from-primary to-primary/70 hover:from-primary/90 hover:to-primary/60 glow-primary"
      >
        <Sparkles className="w-6 h-6" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col" aria-describedby={undefined}>
          <div className="flex h-full">
            {/* Threads sidebar */}
            <aside className="w-48 border-r border-border flex flex-col bg-muted/20">
              <div className="p-2 border-b border-border">
                <Button size="sm" variant="outline" className="w-full justify-start gap-2" onClick={newThread}>
                  <Plus className="w-3.5 h-3.5" /> Nova
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-1 space-y-0.5">
                  {threads.map((t) => (
                    <div key={t.id} className={`group flex items-center gap-1 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-muted ${activeId === t.id ? "bg-muted" : ""}`} onClick={() => setActiveId(t.id)}>
                      <span className="flex-1 truncate">{t.title}</span>
                      <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {threads.length === 0 && <p className="text-xs text-muted-foreground p-2">Nenhuma conversa</p>}
                </div>
              </ScrollArea>
            </aside>

            {/* Conversation */}
            <div className="flex-1 flex flex-col min-w-0">
              <header className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Bot className="w-5 h-5 text-primary" />
                  <h2 className="text-sm font-semibold">Assistente IA</h2>
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </header>

              <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef as any}>
                {messages.length === 0 && !loading && (
                  <div className="flex flex-col items-center text-center gap-3 py-8">
                    <div className="p-3 rounded-full bg-primary/10"><Sparkles className="w-7 h-7 text-primary" /></div>
                    <h3 className="font-semibold">Pergunte sobre o sistema</h3>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      Consulte licenças, aprovações pendentes, despesas, fornecedores, integrações PagCorp, auditoria e mais — sem sair desta tela.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-2">
                      {[
                        "Quantas licenças PRO temos por empresa?",
                        "Quais despesas estão aguardando aprovação?",
                        "Resumo de integrações PagCorp dos últimos 7 dias",
                        "Há licenças ociosas?",
                      ].map((q) => (
                        <button key={q} onClick={() => { setInput(q); setTimeout(() => taRef.current?.focus(), 50); }}
                          className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground">
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60"}`}>
                        {m.role === "assistant" ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0 [&_table]:text-xs [&_table]:my-2">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                        ) : m.content}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-muted/60 rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando dados...
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t border-border p-3 flex gap-2">
                <Textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Pergunte sobre licenças, despesas, fornecedores..."
                  className="min-h-[44px] max-h-32 resize-none text-sm"
                  rows={1}
                />
                <Button onClick={send} disabled={!input.trim() || loading} size="icon" className="h-11 w-11 shrink-0">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
