import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleAuthGate } from "@/components/GoogleAuthGate";
import { consumePostLoginPath } from "@/lib/post-login-redirect";
import { Loader2 } from "lucide-react";

/** Renderizado apenas quando o gate liberou: manda o usuário ao destino original. */
function AfterLoginRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const target = consumePostLoginPath() || "/";
    navigate(target, { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const Login = () => (
  <GoogleAuthGate>
    <AfterLoginRedirect />
  </GoogleAuthGate>
);

export default Login;
