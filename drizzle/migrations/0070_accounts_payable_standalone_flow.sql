ALTER TABLE public.accounts_payable_batch_items
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sap',
  ADD COLUMN IF NOT EXISTS expense_id uuid NULL,
  ADD COLUMN IF NOT EXISTS sap_settlement_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS settlement_note text NULL;

ALTER TABLE public.accounts_payable_batch_items
  ADD CONSTRAINT accounts_payable_batch_items_source_check CHECK (source IN ('sap','flow')),
  ADD CONSTRAINT accounts_payable_batch_items_settlement_check CHECK (sap_settlement_status IN ('not_required','pending','settled','needs_review','error')),
  ADD CONSTRAINT accounts_payable_batch_items_flow_expense_check CHECK (source = 'sap' OR expense_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_payable_batch_items_flow_active_uidx
  ON public.accounts_payable_batch_items (company_db, expense_id)
  WHERE source = 'flow' AND status IN ('remitted','scheduled','paid','sap_processing','sap_error');

CREATE INDEX IF NOT EXISTS accounts_payable_batch_items_settlement_idx
  ON public.accounts_payable_batch_items (company_db, sap_settlement_status)
  WHERE source = 'flow';

ALTER TABLE public.accounts_payable_bank_accounts
  ADD COLUMN IF NOT EXISTS transit_account_code text NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_lock_batch_item_id uuid NULL;

CREATE OR REPLACE FUNCTION public.guard_expense_payment_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.payment_lock_batch_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_lock_batch_item_id IS DISTINCT FROM OLD.payment_lock_batch_item_id THEN
    -- liberar/trocar a trava só pela service role (edge function de pagamentos)
    IF coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Pedido em remessa de pagamento: trava só pode ser alterada pelo Contas a Pagar.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.freight_amount IS DISTINCT FROM OLD.freight_amount
     OR NEW.supplier_code IS DISTINCT FROM OLD.supplier_code
     OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelado','rejeitado','rascunho','pendente_aprovacao')) THEN
    RAISE EXCEPTION 'Pedido em remessa de pagamento: valor, fornecedor, vencimento e cancelamento estão bloqueados até o retorno do banco.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_payment_lock ON public.expenses;
CREATE TRIGGER trg_guard_expense_payment_lock
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_payment_lock();

CREATE OR REPLACE FUNCTION public.guard_expense_items_payment_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_expense uuid := coalesce(NEW.expense_id, OLD.expense_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.expenses WHERE id = v_expense AND payment_lock_batch_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Pedido em remessa de pagamento: itens bloqueados até o retorno do banco.';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_items_payment_lock ON public.expense_items;
CREATE TRIGGER trg_guard_expense_items_payment_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.expense_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_items_payment_lock();