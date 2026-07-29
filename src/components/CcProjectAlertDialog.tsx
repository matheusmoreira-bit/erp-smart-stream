import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

export interface CcProjectAlertInfo {
  lineIndex: number;
  costCenterCode: string;
  costCenterName?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  isInstitutional: boolean;
}

interface Props {
  info: CcProjectAlertInfo | null;
  onConfirm: () => void;
  onChange: () => void;
}

export function CcProjectAlertDialog({ info, onConfirm, onChange }: Props) {
  const open = !!info;
  const projectLabel = info
    ? [info.projectCode, info.projectName].filter(Boolean).join(" — ") ||
      "nenhum projeto selecionado"
    : "";

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Confirme o casamento Centro de Custo × Projeto
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>
                Item {(info?.lineIndex ?? 0) + 1} — Centro de custo{" "}
                <strong>
                  {info?.costCenterCode}
                  {info?.costCenterName ? ` — ${info.costCenterName}` : ""}
                </strong>
                {" "}com o projeto <strong>{projectLabel}</strong>.
              </p>
              <p>
                Em geral, os custos operacionais devem ser lançados de forma
                segregada por <strong>marca/projeto</strong>, e não no projeto
                institucional/corporativo da empresa.
              </p>
              {info?.isInstitutional && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                  O projeto selecionado é institucional/corporativo. Confirme
                  apenas se o custo realmente não pertence a uma marca.
                </p>
              )}
              <p className="text-muted-foreground">
                Esta confirmação fica registrada para auditoria.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onChange}>Alterar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
