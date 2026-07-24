import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { MainMenu } from "@/components/MainMenu";
import { GoogleAuthGate } from "@/components/GoogleAuthGate";
// ProfileCompletionGate desativado temporariamente a pedido do usuário.
// import { ProfileCompletionGate } from "@/components/ProfileCompletionGate";

const Index = () => {
  const { session } = useSap();

  return (
    <GoogleAuthGate>
      {!session ? (
        <SapLoginForm />
      ) : (
        <>
          <MainMenu />
          {/* <ProfileCompletionGate /> */}
        </>
      )}
    </GoogleAuthGate>
  );
};

export default Index;
