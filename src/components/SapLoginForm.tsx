import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, Lock, User, Database, LogIn, Loader2, Settings, Box, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSap } from "@/contexts/SapContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CompanyOption {
  label: string;
  value: string;
  erp_type: string;
}

export function SapLoginForm() {
  const { login, isLoading } = useSap();
  const navigate = useNavigate();
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [companyDB, setCompanyDB] = useState("");
  const [databases, setDatabases] = useState<CompanyOption[]>([]);

  const selectedCompany = databases.find((d) => d.value === companyDB);
  const erpType = selectedCompany?.erp_type || "sap";
  const isOmie = erpType === "omie";

  useEffect(() => {
    supabase
      .from("companies")
      .select("company_db, display_name, erp_type")
      .eq("is_active", true)
      .order("display_name")
      .then(({ data }) => {
        setDatabases(
          (data || []).map((c: any) => ({
            label: c.display_name,
            value: c.company_db,
            erp_type: c.erp_type || "sap",
          }))
        );
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyDB) {
      toast.error("Selecione a empresa");
      return;
    }
    if (!isOmie && (!userName || !password)) {
      toast.error("Preencha todos os campos");
      return;
    }
    try {
      await login(userName, password, companyDB, erpType as "sap" | "omie");
      toast.success(isOmie ? "Conectado ao OMIE!" : "Conectado ao SAP B1!");
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
            ERP <span className="text-gradient">Analytics</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte-se ao seu ERP
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
          {/* Database Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Empresa
            </label>
            <Select value={companyDB} onValueChange={(val) => {
              setCompanyDB(val);
              setUserName("");
              setPassword("");
            }}>
              <SelectTrigger className="bg-muted/30 border-border">
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {databases.map((db) => (
                  <SelectItem key={db.value} value={db.value}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{db.label}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {db.erp_type === "omie" ? "OMIE" : "SAP"}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ERP indicator */}
          {companyDB && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border">
              {isOmie ? (
                <Box className="w-4 h-4 text-primary" />
              ) : (
                <Server className="w-4 h-4 text-primary" />
              )}
              <span className="text-sm text-muted-foreground">
                Conexão via <span className="font-semibold text-foreground">{isOmie ? "OMIE" : "SAP Business One"}</span>
              </span>
            </div>
          )}

          {/* SAP fields — user/password */}
          {!isOmie && (
            <>
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
            </>
          )}

          {/* OMIE info */}
          {isOmie && (
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/20 border border-border">
              O login será feito automaticamente usando as credenciais do OMIE configuradas para esta empresa.
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <LogIn className="w-4 h-4 mr-2" />
            )}
            {isLoading ? "Conectando..." : "Entrar"}
          </Button>
        </form>

        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted-foreground">
            Conexão segura via {isOmie ? "API OMIE" : "Service Layer"}
          </p>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => navigate("/admin/login")}>
            <Settings className="w-3 h-3 mr-1" />
            Admin
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
