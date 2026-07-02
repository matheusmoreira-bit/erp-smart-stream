import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DraftDocType = "purchase" | "sales";

export interface DocumentDraft {
  id: string;
  user_id: string;
  company_db: string;
  doc_type: DraftDocType;
  payload: any;
  preview: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

async function purgeExpired() {
  try {
    await supabase.from("document_drafts").delete().lt("expires_at", new Date().toISOString());
  } catch {
    // silent
  }
}

export function useDocumentDrafts(docType: DraftDocType, companyDb: string | undefined | null) {
  const [drafts, setDrafts] = useState<DocumentDraft[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!companyDb) {
      setDrafts([]);
      return;
    }
    setIsLoading(true);
    try {
      await purgeExpired();
      const { data, error } = await supabase
        .from("document_drafts")
        .select("*")
        .eq("company_db", companyDb)
        .eq("doc_type", docType)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      setDrafts((data as any) || []);
    } catch (e) {
      console.warn("Failed to load drafts:", e);
      setDrafts([]);
    } finally {
      setIsLoading(false);
    }
  }, [companyDb, docType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { drafts, isLoading, refresh };
}

export async function saveDraft(params: {
  docType: DraftDocType;
  companyDb: string;
  payload: any;
  preview: string;
  draftId?: string | null;
}): Promise<string | null> {
  const { docType, companyDb, payload, preview, draftId } = params;
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return null;

    const nextExpires = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

    if (draftId) {
      const { error } = await supabase
        .from("document_drafts")
        .update({ payload, preview, expires_at: nextExpires })
        .eq("id", draftId);
      if (error) throw error;
      return draftId;
    }

    // Upsert by (user_id, company_db, doc_type)
    const { data, error } = await supabase
      .from("document_drafts")
      .upsert(
        {
          user_id: userId,
          company_db: companyDb,
          doc_type: docType,
          payload,
          preview,
          expires_at: nextExpires,
        },
        { onConflict: "user_id,company_db,doc_type" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return (data as any)?.id || null;
  } catch (e) {
    console.warn("saveDraft failed:", e);
    return null;
  }
}

export async function deleteDraft(id: string) {
  try {
    await supabase.from("document_drafts").delete().eq("id", id);
  } catch {
    // silent
  }
}
