import { supabase } from "@/integrations/supabase/client";

/**
 * Helper to create a notification for a user.
 * Can be called from anywhere in the app (hooks, components, edge functions).
 */
export async function createNotification(params: {
  user_identifier: string;
  title: string;
  body?: string;
  category?: string;
  company_db?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabase.from("notifications").insert({
      user_identifier: params.user_identifier.toLowerCase(),
      title: params.title,
      body: params.body || null,
      category: params.category || "system",
      company_db: params.company_db || null,
      link: params.link || null,
      metadata: (params.metadata || {}) as any,
    });
  } catch {
    // silent — notifications should never block main flow
  }
}
