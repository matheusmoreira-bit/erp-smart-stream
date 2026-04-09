import { useState } from "react";
import { motion } from "framer-motion";
import { Activity, Lock, User, Database, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSap } from "@/contexts/SapContext";
import { toast } from "sonner";

const DATABASES = [
  { label: "ANA Gaming", value: "SBO_ANAGAMING" },
  { label: "Cactus", value: "SBO_CACTUS" },
  { label: "Instituto Cactus", value: "SBO_INSTITUTO_ANA" },
];

export function SapLoginForm() {
  const { login, isLoading } = useSap();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [companyDB, setCompanyDB] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName || !password || !companyDB) {
      toast.error("Preencha todos os campos");
      return;
    }
    try {
      await login(userName, password, companyDB);
      toast.success("Conectado ao SAP B1!");
    } catch {
      toast.error("Falha no login. Verifique suas credenciais.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-primary/10 glow-primary mb-4">
            <Activity className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            SAP B1 <span className="text-gradient">Analytics</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte-se ao Service Layer
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
          {/* Database Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Base de Dados
            </label>
            <div className="grid grid-cols-1 gap-2">
              {DATABASES.map((db) => (
                <button
                  key={db.value}
                  type="button"
                  onClick={() => setCompanyDB(db.value)}
                  className={`p-3 rounded-lg border text-left text-sm font-medium transition-all ${
                    companyDB === db.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <span className="block">{db.label}</span>
                  <span className="text-xs opacity-60 font-mono">{db.value}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              Usuário
            </label>
            <Input
              placeholder="Seu usuário SAP"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="bg-muted/30 border-border"
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              Senha
            </label>
            <Input
              type="password"
              placeholder="Sua senha SAP"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-muted/30 border-border"
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <LogIn className="w-4 h-4 mr-2" />
            )}
            {isLoading ? "Conectando..." : "Entrar"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Conexão segura via Service Layer
        </p>
      </motion.div>
    </div>
  );
}
