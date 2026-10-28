import { canonicalUserKey } from "@/lib/text-normalize";
import type { DirectoryUser } from "@/lib/user-identity";

const normalize = (value: string | null | undefined) => (value || "").trim().toLowerCase();

export function approvalHistoryIdentityKeys(
  sessionUser: string | undefined,
  email: string | undefined,
  users: DirectoryUser[],
): Set<string> {
  const identities = [sessionUser, email].map(normalize).filter(Boolean);
  const canonicalKeys = new Set(identities.map(canonicalUserKey).filter(Boolean));
  const matchingUsers = users.filter((u) =>
    canonicalKeys.has(u.user_key) || u.emails.some((e) => identities.includes(normalize(e))),
  );
  const values = [
    ...identities,
    ...matchingUsers.flatMap((u) => [u.sap_user_code, u.display_name, ...u.emails]),
  ].map(normalize).filter(Boolean);
  return new Set(values.flatMap((value) => value.includes("@") ? [value, value.split("@")[0]] : [value]));
}

export function matchesApprovalHistoryIdentity(
  keys: Set<string>,
  candidates: Array<string | null | undefined>,
): boolean {
  return candidates.some((candidate) => {
    const value = normalize(candidate);
    return !!value && (keys.has(value) || (value.includes("@") && keys.has(value.split("@")[0])));
  });
}