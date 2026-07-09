
CREATE TABLE IF NOT EXISTS public.advance_payment_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  advance_id UUID NOT NULL REFERENCES public.advance_payments(id) ON DELETE CASCADE,
  item_code TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  cost_center TEXT,
  cost_center_name TEXT,
  project TEXT,
  project_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advance_payment_items_advance ON public.advance_payment_items(advance_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advance_payment_items TO authenticated;
GRANT ALL ON public.advance_payment_items TO service_role;

ALTER TABLE public.advance_payment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_items_select" ON public.advance_payment_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_payment_items.advance_id
      AND (a.requester_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "advance_items_insert" ON public.advance_payment_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_payment_items.advance_id
      AND (a.requester_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "advance_items_update" ON public.advance_payment_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_payment_items.advance_id
      AND (a.requester_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_payment_items.advance_id
      AND (a.requester_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ));

CREATE POLICY "advance_items_delete" ON public.advance_payment_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_payment_items.advance_id
      AND (a.requester_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  ));
