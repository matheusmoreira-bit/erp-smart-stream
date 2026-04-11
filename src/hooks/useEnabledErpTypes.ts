import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EnabledErpType {
  erp_type: string;
  is_active: boolean;
}

export function useEnabledErpTypes() {
  const [erpTypes, setErpTypes] = useState<EnabledErpType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from("enabled_erp_types")
      .select("erp_type, is_active")
      .order("erp_type");
    setErpTypes(data || []);
    setIsLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const toggle = useCallback(async (erpType: string, isActive: boolean) => {
    await supabase
      .from("enabled_erp_types")
      .update({ is_active: isActive })
      .eq("erp_type", erpType);
    setErpTypes((prev) =>
      prev.map((e) => (e.erp_type === erpType ? { ...e, is_active: isActive } : e))
    );
  }, []);

  const enabledNames = erpTypes.filter((e) => e.is_active).map((e) => e.erp_type);

  return { erpTypes, enabledNames, isLoading, refresh: fetch, toggle };
}
