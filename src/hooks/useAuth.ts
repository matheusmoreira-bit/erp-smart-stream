import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getIsCloudAdmin } from "@/lib/auth-cache";
import { syncKeepAlive } from "@/lib/session-keepalive";

import type { User, Session } from "@supabase/supabase-js";


export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mantém a sessão renovando quando o usuário optou por "manter conectado".
    syncKeepAlive();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
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


    supabase.auth.getSession().then(({ data: { session } }) => {
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
