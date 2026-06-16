
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE public.item_tipo AS ENUM ('produto', 'servico');
CREATE TYPE public.fornecedor_tipo_pessoa AS ENUM ('pj', 'pf');

CREATE TABLE public.item_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo public.item_tipo NOT NULL,
  ncm text,
  codigo_servico text,
  grupo text,
  unidade text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_base_produto_chk CHECK (
    tipo <> 'produto' OR (ncm IS NOT NULL AND ncm ~ '^\d{8}$')
  ),
  CONSTRAINT item_base_servico_chk CHECK (
    tipo <> 'servico' OR (codigo_servico IS NOT NULL AND codigo_servico ~ '^\d+(\.\d+)+$')
  )
);

CREATE UNIQUE INDEX item_base_uniq_ncm ON public.item_base (ncm) WHERE tipo = 'produto';
CREATE UNIQUE INDEX item_base_uniq_cs  ON public.item_base (codigo_servico) WHERE tipo = 'servico';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_base TO authenticated;
GRANT ALL ON public.item_base TO service_role;
ALTER TABLE public.item_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select item_base" ON public.item_base FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert item_base" ON public.item_base FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update item_base" ON public.item_base FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete item_base" ON public.item_base FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER item_base_updated_at BEFORE UPDATE ON public.item_base
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.item_variante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_base_id uuid NOT NULL REFERENCES public.item_base(id) ON DELETE CASCADE,
  sequencial int NOT NULL,
  descricao text NOT NULL,
  codigo_completo text NOT NULL UNIQUE,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_base_id, sequencial)
);

CREATE INDEX item_variante_base_idx ON public.item_variante (item_base_id);
CREATE INDEX item_variante_descricao_trgm ON public.item_variante USING gin (descricao public.gin_trgm_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_variante TO authenticated;
GRANT ALL ON public.item_variante TO service_role;
ALTER TABLE public.item_variante ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select item_variante" ON public.item_variante FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert item_variante" ON public.item_variante FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update item_variante" ON public.item_variante FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete item_variante" ON public.item_variante FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER item_variante_updated_at BEFORE UPDATE ON public.item_variante
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.preview_next_codigo(p_item_base_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo public.item_tipo;
  v_ncm text;
  v_cs text;
  v_next int;
BEGIN
  SELECT tipo, ncm, codigo_servico INTO v_tipo, v_ncm, v_cs
  FROM public.item_base WHERE id = p_item_base_id;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'item_base not found';
  END IF;
  SELECT COALESCE(MAX(sequencial), 0) + 1 INTO v_next
  FROM public.item_variante WHERE item_base_id = p_item_base_id;
  IF v_tipo = 'produto' THEN
    RETURN 'P' || v_ncm || '.' || lpad(v_next::text, 3, '0');
  ELSE
    RETURN 'S' || v_cs || '.' || lpad(v_next::text, 4, '0');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_item_variante(
  p_item_base_id uuid,
  p_descricao text
)
RETURNS public.item_variante
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo public.item_tipo;
  v_ncm text;
  v_cs text;
  v_next int;
  v_codigo text;
  v_row public.item_variante;
  v_attempts int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_descricao IS NULL OR length(btrim(p_descricao)) = 0 THEN
    RAISE EXCEPTION 'descricao obrigatoria';
  END IF;

  SELECT tipo, ncm, codigo_servico INTO v_tipo, v_ncm, v_cs
  FROM public.item_base WHERE id = p_item_base_id FOR UPDATE;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'item_base not found';
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    SELECT COALESCE(MAX(sequencial), 0) + 1 INTO v_next
    FROM public.item_variante WHERE item_base_id = p_item_base_id;

    IF v_tipo = 'produto' THEN
      v_codigo := 'P' || v_ncm || '.' || lpad(v_next::text, 3, '0');
    ELSE
      v_codigo := 'S' || v_cs || '.' || lpad(v_next::text, 4, '0');
    END IF;

    BEGIN
      INSERT INTO public.item_variante (item_base_id, sequencial, descricao, codigo_completo)
      VALUES (p_item_base_id, v_next, btrim(p_descricao), v_codigo)
      RETURNING * INTO v_row;
      RETURN v_row;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_next_codigo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_item_variante(uuid, text) TO authenticated;

CREATE TABLE public.fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_pessoa public.fornecedor_tipo_pessoa NOT NULL,
  cnpj text,
  cpf text,
  razao_social text,
  nome_fantasia text,
  tipo_estabelecimento text,
  situacao_cadastral text,
  data_inicio_atividade date,
  natureza_juridica_id text,
  natureza_juridica_descricao text,
  porte text,
  capital_social numeric,
  cnae_principal_codigo text,
  cnae_principal_descricao text,
  cnaes_secundarios jsonb DEFAULT '[]'::jsonb,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep text,
  municipio text,
  municipio_ibge text,
  uf text,
  pais text,
  telefone1 text,
  telefone2 text,
  email text,
  inscricao_estadual text,
  simples_nacional boolean,
  socios jsonb DEFAULT '[]'::jsonb,
  api_payload jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedores_pj_chk CHECK (
    tipo_pessoa <> 'pj' OR (cnpj IS NOT NULL AND cnpj ~ '^\d{14}$')
  ),
  CONSTRAINT fornecedores_pf_chk CHECK (
    tipo_pessoa <> 'pf' OR (cpf IS NOT NULL AND cpf ~ '^\d{11}$')
  )
);

CREATE UNIQUE INDEX fornecedores_uniq_cnpj ON public.fornecedores (cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX fornecedores_uniq_cpf  ON public.fornecedores (cpf) WHERE cpf IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fornecedores TO authenticated;
GRANT ALL ON public.fornecedores TO service_role;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select fornecedores" ON public.fornecedores FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert fornecedores" ON public.fornecedores FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth update fornecedores" ON public.fornecedores FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin delete fornecedores" ON public.fornecedores FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER fornecedores_updated_at BEFORE UPDATE ON public.fornecedores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
