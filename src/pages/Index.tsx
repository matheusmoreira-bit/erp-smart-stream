import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { MainMenu } from "@/components/MainMenu";
import { ProfileCompletionGate } from "@/components/ProfileCompletionGate";

const Index = () => {
  const { session } = useSap();

  if (!session) {
    return <SapLoginForm />;
  }

  return (
    <>
      <MainMenu />
      <ProfileCompletionGate />
    </>
  );
};

export default Index;
