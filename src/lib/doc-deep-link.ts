import { toast } from "sonner";

/**
 * Build a shareable direct link to a specific document within a page.
 * Uses the `doc` query param on the given path, e.g. `/compras?doc=<id>`.
 */
export function buildDocLink(path: string, docId: string): string {
  const url = new URL(window.location.origin + path);
  url.searchParams.set("doc", docId);
  return url.toString();
}

/** Copy a document link to clipboard and toast the result. */
export async function copyDocLink(path: string, docId: string, label = "Link do documento copiado") {
  const link = buildDocLink(path, docId);
  try {
    await navigator.clipboard.writeText(link);
    toast.success(label, { description: link });
  } catch {
    // Fallback: prompt so the user can copy manually
    window.prompt("Copie o link do documento:", link);
  }
}

/** Read the `doc` query param from the current URL (or a given search string). */
export function readDocParam(search: string = window.location.search): string | null {
  try {
    const p = new URLSearchParams(search);
    const v = p.get("doc");
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Update the `doc` query param in the URL without adding a history entry. */
export function setDocParam(docId: string | null) {
  const url = new URL(window.location.href);
  if (docId) url.searchParams.set("doc", docId);
  else url.searchParams.delete("doc");
  window.history.replaceState({}, "", url.toString());
}
