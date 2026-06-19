import { Helmet } from "react-helmet-async";

interface PageTitleProps {
  title: string;
}

/**
 * Sets the browser tab title for the current route.
 * Format: "{title} — ERP Flow".
 */
export function PageTitle({ title }: PageTitleProps) {
  return (
    <Helmet>
      <title>{`${title} — ERP Flow`}</title>
    </Helmet>
  );
}
