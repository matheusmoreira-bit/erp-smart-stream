import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { Dashboard } from "@/components/Dashboard";

const Index = () => {
  const { session } = useSap();

  if (!session) {
    return <SapLoginForm />;
  }

  return <Dashboard />;
};

export default Index;
