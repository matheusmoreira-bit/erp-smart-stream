
-- Create expense status enum
CREATE TYPE public.expense_status AS ENUM (
  'rascunho',
  'pendente_aprovacao',
  'aprovado',
  'rejeitado',
  'pc_lancado',
  'nf_entrada',
  'pagamento',
  'finalizado'
);

-- Create expenses table
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_code TEXT,
  supplier_name TEXT NOT NULL,
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  cost_center TEXT,
  project TEXT,
  remarks TEXT,
  status public.expense_status NOT NULL DEFAULT 'rascunho',
  requester_name TEXT NOT NULL,
  requester_email TEXT,
  current_approver TEXT,
  sap_doc_entry INTEGER,
  sap_doc_num INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create expense items table
CREATE TABLE public.expense_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  item_code TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(18,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  cost_center TEXT,
  project TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create expense attachments metadata table
CREATE TABLE public.expense_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_attachments ENABLE ROW LEVEL SECURITY;

-- Policies: open access (auth is handled by SAP session externally)
CREATE POLICY "Allow all access to expenses" ON public.expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expense_items" ON public.expense_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to expense_attachments" ON public.expense_attachments FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_expenses_status ON public.expenses(status);
CREATE INDEX idx_expenses_requester ON public.expenses(requester_name);
CREATE INDEX idx_expense_items_expense_id ON public.expense_items(expense_id);
CREATE INDEX idx_expense_attachments_expense_id ON public.expense_attachments(expense_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('expense-attachments', 'expense-attachments', true);

CREATE POLICY "Allow all access to expense attachments storage"
  ON storage.objects FOR ALL
  USING (bucket_id = 'expense-attachments')
  WITH CHECK (bucket_id = 'expense-attachments');
