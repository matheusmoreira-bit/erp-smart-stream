import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Send, Loader2, Sparkles, ShieldAlert, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";

type ToolStep = { name: string; label: string; status: "running" | "done" | "error" };
type Msg = { role: "user" | "assistant"; content: string; steps?: ToolStep[] };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot-chat`;

const SUGGESTIONS = [
  "Quais aprovações pendentes há mais de 3 dias?",
  "Liste as últimas 10 falhas de integração SAP",
  "Mostre baixas PagCorp travadas hoje",
  "Quem são os aprovadores sem telefone cadastrado?",
];

export default function BackofficeCopilot() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const nextMsgs = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMsgs);
    setInput("");
    setLoading(true);

    let acc = "";
    let steps: ToolStep[] = [];
    const patchLast = (patch: Partial<Msg>) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, ...patch } : m));
        }
        return [...prev, { role: "assistant", content: "", ...patch }];
      });
    };
    const upsert = (chunk: string) => {
      acc += chunk;
      patchLast({ content: acc });
    };
    const upsertTool = (t: ToolStep) => {
      const idx = steps.findIndex((s) => s.name === t.name && s.status === "running");
      steps = idx >= 0 && t.status !== "running"
        ? steps.map((s, i) => (i === idx ? t : s))
        : [...steps, t];
      patchLast({ steps: [...steps] });
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sessão expirada. Faça login novamente no backoffice.");

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({ messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })) }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Erro ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.tool) upsertTool(parsed.tool as ToolStep);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) upsert(c);
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch (e) {
      upsert(`\n\n⚠️ ${e instanceof Error ? e.message : "Erro ao consultar o copiloto."}`);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 flex flex-col h-[calc(100vh-4rem)]">
      <BackofficePageHeader
        title="Copiloto Operacional"
        description="Consulte o banco, diagnostique fluxos e execute ações operacionais com confirmação."
        icon={<Sparkles className="h-5 w-5 text-primary" />}
        actions={<Badge variant="secondary" className="text-xs">Backoffice</Badge>}
      />

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b bg-amber-500/5 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <ShieldAlert className="w-3.5 h-3.5" />
          Ações de escrita exigem sua confirmação explícita antes de serem executadas. Todas ficam auditadas.
        </div>

        <ScrollArea className="flex-1 px-4 py-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <div className="p-4 rounded-full bg-primary/10">
                <Bot className="w-10 h-10 text-primary" />
              </div>
              <h2 className="font-semibold text-lg">Como posso ajudar?</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Peça diagnósticos, cruzamentos ou ações. Ex: redirecionar aprovações, reprocessar
                integrações SAP/PagCorp, criar/desativar regras.
              </p>
              <div className="flex flex-wrap gap-2 mt-2 max-w-2xl justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 30); }}
                    className="text-xs px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-foreground"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <>
                      {!!m.steps?.length && (
                        <div className="mb-2 space-y-1">
                          {m.steps.map((s, si) => (
                            <div key={si} className="flex items-center gap-2 text-xs text-muted-foreground">
                              {s.status === "running" ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : s.status === "error" ? (
                                <ShieldAlert className="w-3 h-3 text-destructive" />
                              ) : (
                                <Check className="w-3 h-3 text-primary" />
                              )}
                              <span>{s.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:m-0 [&>p+p]:mt-2 [&>ul]:mt-1 [&>ol]:mt-1 [&_table]:my-2 [&_code]:text-xs">
                        <ReactMarkdown>{m.content || (m.steps?.length ? "" : "…")}</ReactMarkdown>
                      </div>
                      </>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )}
                  </div>
                </div>
              ))}
              {loading && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex justify-start">
                  <div className="bg-muted/60 rounded-xl px-4 py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="border-t p-3 flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Pergunte ao copiloto (Enter envia, Shift+Enter quebra linha)…"
            className="min-h-[48px] max-h-40 resize-none text-sm"
            rows={1}
            disabled={loading}
          />
          <Button onClick={send} disabled={!input.trim() || loading} size="icon" className="h-12 w-12 shrink-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </Card>
    </div>
  );
}
