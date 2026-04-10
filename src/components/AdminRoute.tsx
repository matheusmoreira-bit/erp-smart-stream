import { Navigate } from "react-router-dom";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = localStorage.getItem("admin_authenticated") === "true";
  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
