import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { Dashboard } from "@/components/Dashboard";

export default function AnalyticsPage() {
  const { session } = useSap();
  if (!session) return <SapLoginForm />;
  return <Dashboard />;
}
