// In-memory handoff for pre-attached files across a single navigation.
// Used to route the PDF/XML of an incoming NF into the "Nova Compra" modal
// on the Expenses page without persisting binary blobs to storage.

let pendingFiles: File[] | null = null;

export function setPendingPurchaseFiles(files: File[] | null): void {
  pendingFiles = files && files.length > 0 ? files : null;
}

export function consumePendingPurchaseFiles(): File[] | null {
  const files = pendingFiles;
  pendingFiles = null;
  return files;
}

export function peekPendingPurchaseFiles(): File[] | null {
  return pendingFiles;
}
