import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Returns false ONLY when we could decode the JWT payload and it truly
    // has no `sub`. Any decode failure is treated as "assume valid" so we never
    // destroy a working session because of encoding quirks (accents, etc).
    const tokenHasSub = (token?: string | null) => {
      if (!token) return false;
      try {
        const rawPayload = token.split(".")[1] || "";
        const base64 = rawPayload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        const json = new TextDecoder("utf-8").decode(bytes);
        const payload = JSON.parse(json);
        return typeof payload?.sub === "string" && payload.sub.length > 0;
      } catch {
        return true;
      }
    };


    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // Defensive: a session whose access_token lacks `sub` is corrupt
        // (legacy/anon JWT). It causes every protected edge function to 401
        // with "Não autenticado". Force a clean signOut so the user re-logs.
        if (session && !tokenHasSub(session.access_token)) {
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(async () => {
            setIsAdmin(await getIsCloudAdmin());
            setLoading(false);
          }, 0);
        } else {
          setIsAdmin(false);
          setLoading(false);
        }
      }
    );

    const hydrateAdmin = async (_userId: string) => {
      setIsAdmin(await getIsCloudAdmin());
      setLoading(false);
    };


    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session && !tokenHasSub(session.access_token)) {
        // Token is corrupt (missing `sub`) — try a non-destructive refresh
        // before forcing the user to re-login.
        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data.session && tokenHasSub(data.session.access_token)) {
            setSession(data.session);
            setUser(data.session.user ?? null);
            hydrateAdmin(data.session.user.id);
            return;
          }
        } catch { /* ignore */ }
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        hydrateAdmin(session.user.id);
      } else {
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, session, isAdmin, loading, signIn, signUp, signOut };
}
