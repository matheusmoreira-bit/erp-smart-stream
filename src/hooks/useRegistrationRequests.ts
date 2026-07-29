import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  RegistrationBankDetails,
  RegistrationMode,
  RegistrationPaymentMethod,
} from "@/lib/supplier-request-email";
import { sendRegistrationStatusEmail } from "@/lib/supplier-request-email";
import {
  uploadRegistrationAttachments,
  type RegistrationAttachment,
} from "@/lib/registration-attachments";

export type RegistrationStatus = "aberto" | "em_andamento" | "pendente_solicitante" | "concluido" | "cancelado";
export type RegistrationType = "supplier" | "item";

export interface RegistrationRequest {
  id: string;
  request_type: RegistrationType;
  status: RegistrationStatus;
  title: string;
  requester_email: string;
  requester_name: string | null;
  company_db: string | null;
  context: string | null;
  federal_tax_id: string | null;
  contact_email: string | null;
  phone1: string | null;
  phone2: string | null;
  currency: string | null;
  address: Record<string, unknown>;
  payment_method: RegistrationPaymentMethod | null;
  bank_details: RegistrationBankDetails;
  registration_mode: RegistrationMode;
  notes: string | null;
  attachments: RegistrationAttachment[];
  transaction: Record<string, unknown> | null;
  assignee_email: string | null;
  sap_card_code: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  due_at: string;
  created_at: string;
  updated_at: string;
}

export interface RegistrationRequestEvent {
  id: string;
  request_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  message: string | null;
  author_email: string;
  author_name: string | null;
  attachments: RegistrationAttachment[];
  created_at: string;
}

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  pendente_solicitante: "Pendente do solicitante",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

export const STATUS_ORDER: RegistrationStatus[] = [
  "aberto",
  "em_andamento",
  "pendente_solicitante",
  "concluido",
  "cancelado",
];

export const TYPE_LABELS: Record<RegistrationType, string> = {
  supplier: "Fornecedor",
  item: "Item",
};

/** SLA: 48h úteis já calculadas no banco (due_at). */
export function slaInfo(req: RegistrationRequest) {
  const closed = req.status === "concluido" || req.status === "cancelado";
  const due = new Date(req.due_at);
  const ref = closed && req.resolved_at ? new Date(req.resolved_at) : new Date();
  const diffMs = due.getTime() - ref.getTime();
  const overdue = diffMs < 0;
  const hours = Math.floor(Math.abs(diffMs) / 3_600_000);
  const label = overdue
    ? `${hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`} em atraso`
    : `${hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`} restantes`;
  return { closed, overdue, label, due };
}

export function useRegistrationRequests(options?: { onlyMine?: boolean }) {
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAgent, setIsAgent] = useState(false);
  const [myEmail, setMyEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: userData }, agentRes] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("is_registration_agent"),
      ]);
      setMyEmail(userData.user?.email ?? null);
      setIsAgent(Boolean(agentRes.data));

      let query = supabase
        .from("registration_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (options?.onlyMine && userData.user?.email) {
        query = query.eq("requester_email", userData.user.email.toLowerCase());
      }

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      setRequests((data || []) as unknown as RegistrationRequest[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar solicitações");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [options?.onlyMine]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(
    () => requests.filter((r) => myEmail && r.requester_email.toLowerCase() === myEmail.toLowerCase()),
    [requests, myEmail],
  );

  const addEvent = useCallback(
    async (requestId: string, event: Partial<RegistrationRequestEvent> & { event_type: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) throw new Error("Sessão expirada");
      const { error: evErr } = await supabase.from("registration_request_events").insert({
        request_id: requestId,
        event_type: event.event_type,
        from_status: event.from_status ?? null,
        to_status: event.to_status ?? null,
        message: event.message ?? null,
        author_email: email.toLowerCase(),
        author_name: event.author_name ?? null,
        attachments: (event.attachments ?? []) as never,
      });
      if (evErr) throw evErr;
    },
    [],
  );

  const updateStatus = useCallback(
    async (
      req: RegistrationRequest,
      status: RegistrationStatus,
      extra?: { sapCardCode?: string | null; resolutionNote?: string | null; notify?: boolean },
    ) => {
      const { data: userData } = await supabase.auth.getUser();
      const actor = userData.user?.email?.toLowerCase() ?? null;
      const closing = status === "concluido" || status === "cancelado";

      const { error: upErr } = await supabase
        .from("registration_requests")
        .update({
          status,
          assignee_email: req.assignee_email ?? actor,
          sap_card_code: extra?.sapCardCode ?? req.sap_card_code,
          resolution_note: extra?.resolutionNote ?? req.resolution_note,
          resolved_at: closing ? new Date().toISOString() : null,
          resolved_by: closing ? actor : null,
        })
        .eq("id", req.id);
      if (upErr) throw upErr;

      await addEvent(req.id, {
        event_type: "status",
        from_status: req.status,
        to_status: status,
        message: extra?.resolutionNote ?? null,
      });

      if (extra?.notify !== false && req.requester_email) {
        try {
          await sendRegistrationStatusEmail({
            to: req.requester_email,
            requestId: req.id,
            requestType: req.request_type,
            title: req.title,
            status,
            statusLabel: STATUS_LABELS[status],
            sapCardCode: extra?.sapCardCode ?? req.sap_card_code,
            resolutionNote: extra?.resolutionNote ?? null,
            handledBy: actor,
          });
        } catch {
          /* notificação é best-effort */
        }
      }

      await load();
    },
    [addEvent, load],
  );

  const addComment = useCallback(
    async (requestId: string, message: string, files?: File[]) => {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.toLowerCase() ?? null;
      let uploaded: RegistrationAttachment[] = [];
      if (files?.length) {
        uploaded = await uploadRegistrationAttachments(requestId, files, email);
        const { data: current } = await supabase
          .from("registration_requests")
          .select("attachments")
          .eq("id", requestId)
          .maybeSingle();
        const merged = [...(((current?.attachments as unknown as RegistrationAttachment[]) || [])), ...uploaded];
        await supabase
          .from("registration_requests")
          .update({ attachments: merged as never })
          .eq("id", requestId);
      }
      await addEvent(requestId, {
        event_type: uploaded.length && !message ? "attachment" : "comment",
        message: message || `${uploaded.length} anexo(s) adicionado(s)`,
        attachments: uploaded,
      });
    },
    [addEvent],
  );

  return { requests, mine, loading, error, isAgent, myEmail, reload: load, updateStatus, addComment };
}

export function useRegistrationRequestEvents(requestId: string | null) {
  const [events, setEvents] = useState<RegistrationRequestEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!requestId) {
      setEvents([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("registration_request_events")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });
    setEvents((data || []) as RegistrationRequestEvent[]);
    setLoading(false);
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { events, loading, reload: load };
}
