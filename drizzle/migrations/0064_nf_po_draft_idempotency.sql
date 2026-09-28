-- Reserva durável: não expira automaticamente após envio de resultado incerto.
CREATE TABLE public.nf_po_draft_jobs (
  import_id uuid PRIMARY KEY REFERENCES public.nf_entrada_imports(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('processing', 'uncertain', 'completed')),
  token uuid NOT NULL,
  draft_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'completed' OR draft_id IS NOT NULL)
);
ALTER TABLE public.nf_po_draft_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nf_po_draft_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_po_draft_jobs TO service_role;

-- Revalida o estado atual ao reservar; não confiar no snapshot do handler.
CREATE FUNCTION public.validate_nf_po_draft_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM public.nf_entrada_imports WHERE id = NEW.import_id FOR UPDATE;
  IF current_status IS NULL OR current_status NOT IN ('pending_expense', 'integration_error') THEN
    RAISE EXCEPTION 'NF não elegível para criação de Draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_nf_po_draft_job() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_nf_po_draft_job BEFORE INSERT ON public.nf_po_draft_jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_nf_po_draft_job();

-- Não cancelar/rejeitar uma criação cujo resultado remoto ainda é desconhecido.
CREATE FUNCTION public.guard_nf_po_draft_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('cancelled', 'erpflow_rejected', 'sap_rejected', 'completed')
     AND EXISTS (SELECT 1 FROM public.nf_po_draft_jobs WHERE import_id = OLD.id AND state IN ('processing', 'uncertain')) THEN
    RAISE EXCEPTION 'Reconcilie a integração em andamento antes de alterar o estado da NF' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_nf_po_draft_transition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_nf_po_draft_transition BEFORE UPDATE OF status ON public.nf_entrada_imports
FOR EACH ROW EXECUTE FUNCTION public.guard_nf_po_draft_transition();
