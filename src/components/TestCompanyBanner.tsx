import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSap } from "@/contexts/SapContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SEEN_KEY = "erp_test_company_notice_seen";

/**
 * When the logged-in company is flagged as `is_test`, wraps the app with a
 * red border and shows a one-time popup per session warning the user.
 */
export function TestCompanyBanner() {
  const { session } = useSap();
  const [isTest, setIsTest] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    if (!session?.companyDB) {
      setIsTest(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("companies")
        .select("display_name, is_test")
        .eq("company_db", session.companyDB)
        .maybeSingle();
      if (cancelled) return;
      const testFlag = !!(data as any)?.is_test;
      setIsTest(testFlag);
      setCompanyName((data as any)?.display_name || session.companyDB);
      if (testFlag) {
        const seenKey = `${SEEN_KEY}:${session.companyDB}:${session.sessionId || session.userName || ""}`;
        if (!sessionStorage.getItem(seenKey)) {
          setShowDialog(true);
          sessionStorage.setItem(seenKey, "1");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session?.companyDB, session?.sessionId, session?.userName]);

  if (!isTest) return null;

  return (
    <>
      {/* Red border overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-[60] border-4 border-red-600"
        aria-hidden="true"
      />
      {/* Corner badge */}
      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[61] pointer-events-none">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-600 text-white text-xs font-semibold shadow-lg">
          <AlertTriangle className="w-3.5 h-3.5" />
          AMBIENTE DE TESTE — {companyName}
        </div>
      </div>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent className="border-red-600 border-2">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Empresa de teste
            </AlertDialogTitle>
            <AlertDialogDescription>
              Você está conectado à empresa <strong>{companyName}</strong>, que está marcada como
              <strong> ambiente de teste</strong>. Qualquer documento criado aqui não deve ser
              considerado produção. Prossiga apenas se estiver realizando validações ou treinamento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700">
              Entendi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
