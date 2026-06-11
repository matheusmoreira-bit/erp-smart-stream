import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Mede a altura do <header> sticky da página atual e expõe via CSS var
 * --app-header-h, para que os cabeçalhos de tabela (sticky) fiquem
 * logo abaixo do header sem sobreposição nem gaps.
 */
export function StickyHeaderMeasure() {
  const location = useLocation();

  useEffect(() => {
    const update = () => {
      // Pega o primeiro <header> que tenha a classe border-b (padrão das páginas)
      const header = document.querySelector<HTMLElement>("header.border-b");
      const h = header?.offsetHeight ?? 72;
      document.documentElement.style.setProperty("--app-header-h", `${h}px`);
    };

    update();
    // Pequeno delay para casos onde o header é montado após o effect
    const t = window.setTimeout(update, 50);

    const ro = new ResizeObserver(update);
    const header = document.querySelector<HTMLElement>("header.border-b");
    if (header) ro.observe(header);

    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [location.pathname]);

  return null;
}
