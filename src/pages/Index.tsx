import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSap } from "@/contexts/SapContext";
import { SapLoginForm } from "@/components/SapLoginForm";
import { MainMenu } from "@/components/MainMenu";
import { GoogleAuthGate } from "@/components/GoogleAuthGate";
import { consumePostLoginPath } from "@/lib/post-login-redirect";
// ProfileCompletionGate desativado temporariamente a pedido do usuário.
// import { ProfileCompletionGate } from "@/components/ProfileCompletionGate";

const Index = () => {
  const { session } = useSap();
  const navigate = useNavigate();

  // Retoma o link original (ex.: /aprovacoes?doc=internal:...) assim que a
  // sessão da empresa é estabelecida.
  useEffect(() => {
    if (!session) return;
    const target = consumePostLoginPath();
    if (target) navigate(target, { replace: true });
  }, [session, navigate]);

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
