import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { MainMenu } from "@/components/MainMenu";

const Index = () => {
  const { session } = useSap();

  if (!session) {
    return <SapLoginForm />;
  }

  return <MainMenu />;
};

export default Index;
