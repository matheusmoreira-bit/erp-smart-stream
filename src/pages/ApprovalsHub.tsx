import { useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import Approvals from "./Approvals";
import ApprovalHistory from "./ApprovalHistory";
import { useModuleAccess } from "@/hooks/usePermissions";
import { HubTabs } from "@/components/HubTabs";

export default function ApprovalsHub() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const { userModules } = useModuleAccess();

  const tabs = [
    { key: "pending", label: "Pendentes", module: "approvals" },
    { key: "history", label: "Histórico", module: "approval_history" },
  ].filter((t) => userModules.includes(t.module) || userModules.length === 0);

  const active =
    tabs.find((t) => t.key === tabParam)?.key || tabs[0]?.key || "pending";

  // Normalize URL if invalid tab passed
  useEffect(() => {
    if (tabParam && tabParam !== active) {
      setParams({ tab: active }, { replace: true });
    }
  }, [tabParam, active, setParams]);

  return active === "history" ? <ApprovalHistory /> : <Approvals />;
}
